import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { type Language, newId } from '@cannopy/core';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { authCodes, sessions, users } from '../db/schema/index.js';
import { ApiError } from './errors.js';
import type { SmsSender } from './sms.js';
import type { Tx } from './tx.js';

/**
 * Phone sign-in with a one-time code (docs/architecture.md, decision 8).
 *
 * 1. `requestCode` makes a 6-digit code, stores only its HMAC, and hands the
 *    text to the SMS sender.
 * 2. `verifyCode` checks the newest unconsumed code for that phone, creates
 *    the user on first sign-in, and opens a device session. The session token
 *    is random, shown once, and stored as an HMAC: a database leak gives no
 *    one a session.
 * 3. `authenticate` turns a bearer token into the acting user on every request.
 *
 * Limits: a code lives 10 minutes and allows 5 wrong tries; a phone can ask
 * for 5 codes an hour. Both are enough for a shop owner with poor signal and
 * small enough that guessing is hopeless.
 */
export const CODE_TTL_SECONDS = 10 * 60;
export const CODE_MAX_ATTEMPTS = 5;
export const CODES_PER_HOUR = 5;

export interface AuthOptions {
  secret: string;
  sms: SmsSender;
  /** Fixed code for testing; see AUTH_DEV_CODE in config.ts. */
  devCode?: string | undefined;
  /** Whether verify replies may carry the code (never in production). */
  revealCodes: boolean;
  sessionDays: number;
}

export interface AuthUser {
  userId: string;
  sessionId: string;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly options: AuthOptions,
  ) {}

  private hmac(value: string, purpose: 'code' | 'session'): string {
    return createHmac('sha256', this.options.secret).update(`${purpose}:${value}`).digest('hex');
  }

  async requestCode(
    phone: string,
    language: Language,
  ): Promise<{ expiresInSeconds: number; devCode?: string }> {
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const [recent] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(authCodes)
      .where(and(eq(authCodes.phone, phone), gt(authCodes.createdAt, hourAgo)));
    if ((recent?.n ?? 0) >= CODES_PER_HOUR) {
      throw new ApiError(429, 'too_many_codes', 'Too many codes were sent to this number');
    }

    const code = this.options.devCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.transaction(async (tx) => {
      // Only the newest code counts, so older ones are closed off.
      await tx
        .update(authCodes)
        .set({ consumedAt: new Date() })
        .where(and(eq(authCodes.phone, phone), isNull(authCodes.consumedAt)));
      await tx.insert(authCodes).values({
        id: newId(),
        phone,
        codeHash: this.hmac(code, 'code'),
        expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
      });
    });

    if (!this.options.devCode) {
      await this.options.sms.send({ to: phone, text: codeText(code, language), language });
    }
    return {
      expiresInSeconds: CODE_TTL_SECONDS,
      ...(this.options.revealCodes ? { devCode: code } : {}),
    };
  }

  /** Checks the code and opens a session. Returns the token to put on the device. */
  async verifyCode(input: {
    phone: string;
    code: string;
    deviceId: string;
    deviceName?: string | undefined;
    language?: Language | undefined;
  }): Promise<{ token: string; userId: string; isNewUser: boolean }> {
    const [pending] = await this.db
      .select()
      .from(authCodes)
      .where(and(eq(authCodes.phone, input.phone), isNull(authCodes.consumedAt)))
      .orderBy(desc(authCodes.createdAt))
      .limit(1);
    const wrong = () => new ApiError(401, 'wrong_code', 'That code is not right');
    if (!pending || pending.expiresAt.getTime() < Date.now()) {
      throw new ApiError(401, 'code_expired', 'Ask for a new code');
    }
    if (pending.attempts >= CODE_MAX_ATTEMPTS) {
      throw new ApiError(401, 'code_expired', 'Too many wrong tries; ask for a new code');
    }
    const expected = Buffer.from(pending.codeHash, 'hex');
    const given = Buffer.from(this.hmac(input.code, 'code'), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await this.db
        .update(authCodes)
        .set({ attempts: pending.attempts + 1 })
        .where(eq(authCodes.id, pending.id));
      throw wrong();
    }

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    return this.db.transaction(async (tx) => {
      await tx.update(authCodes).set({ consumedAt: now }).where(eq(authCodes.id, pending.id));
      const { userId, isNewUser } = await findOrCreateUser(tx, input.phone, input.language, now);
      await tx.insert(sessions).values({
        id: newId(),
        userId,
        tokenHash: this.hmac(token, 'session'),
        deviceId: input.deviceId,
        deviceName: input.deviceName ?? '',
        expiresAt: new Date(now.getTime() + this.options.sessionDays * 86_400_000),
      });
      return { token, userId, isNewUser };
    });
  }

  /** The acting user for a bearer token, or null when the token is unknown, expired or revoked. */
  async authenticate(token: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select({
        id: sessions.id,
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        lastSeenAt: sessions.lastSeenAt,
      })
      .from(sessions)
      .where(eq(sessions.tokenHash, this.hmac(token, 'session')))
      .limit(1);
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;
    // Touch at most once an hour so a busy sync does not write the row every call.
    if (Date.now() - row.lastSeenAt.getTime() > 60 * 60_000) {
      await this.db
        .update(sessions)
        .set({
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + this.options.sessionDays * 86_400_000),
        })
        .where(eq(sessions.id, row.id));
    }
    return { userId: row.userId, sessionId: row.id };
  }

  async signOut(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  /** Signs every device of a user out except the one asking. */
  async signOutOtherDevices(userId: string, keepSessionId: string): Promise<number> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          sql`${sessions.id} <> ${keepSessionId}`,
        ),
      )
      .returning({ id: sessions.id });
    return rows.length;
  }
}

async function findOrCreateUser(
  tx: Tx,
  phone: string,
  language: Language | undefined,
  now: Date,
): Promise<{ userId: string; isNewUser: boolean }> {
  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);
  if (existing) {
    await tx
      .update(users)
      .set({ lastSignInAt: now, ...(language ? { language } : {}) })
      .where(eq(users.id, existing.id));
    return { userId: existing.id, isNewUser: false };
  }
  const id = newId();
  await tx.insert(users).values({
    id,
    phone,
    name: '',
    language: language ?? 'my',
    lastSignInAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return { userId: id, isNewUser: true };
}

function codeText(code: string, language: Language): string {
  return language === 'my'
    ? `Cannopy GO ဝင်ရောက်ရန် ကုဒ် ${code} (၁၀ မိနစ်အတွင်း သုံးပါ)`
    : `Your Cannopy GO sign-in code is ${code}. It works for 10 minutes.`;
}
