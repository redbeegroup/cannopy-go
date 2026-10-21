import { newId } from '@cannopy/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { memorySender } from './services/sms.js';
import { closeTestDb, hasTestDb, testDb } from './test/db.js';
import { ApiClient, testPhone } from './test/fixtures.js';

const config = { NODE_ENV: 'test' as const, LOG_LEVEL: 'error' as const, corsOrigins: [] };

describe.skipIf(!hasTestDb)('sign-in and membership', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const sms = memorySender();

  beforeAll(async () => {
    const { db } = await testDb();
    app = await buildApp({ config, db, sms });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it('sends a code to the phone, signs in, and the token opens the API', async () => {
    const phone = testPhone();
    const asked = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      payload: { phone, language: 'en' },
    });
    expect(asked.statusCode).toBe(200);
    const { devCode, expiresInSeconds } = asked.json() as {
      devCode: string;
      expiresInSeconds: number;
    };
    expect(devCode).toMatch(/^\d{6}$/);
    expect(expiresInSeconds).toBe(600);
    const text = sms.sent.find((m) => m.to === phone)?.text;
    expect(text).toContain(devCode);

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      payload: { phone, code: devCode === '000000' ? '000001' : '000000', deviceId: 'phone-1' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe('wrong_code');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      payload: { phone, code: devCode, deviceId: 'phone-1', deviceName: 'Redmi' },
    });
    expect(ok.statusCode).toBe(200);
    const signedIn = ok.json();
    expect(signedIn.isNewUser).toBe(true);
    expect(signedIn.user.phone).toBe(phone);
    expect(signedIn.businesses).toEqual([]);
    expect(signedIn.invites).toEqual([]);

    // A code is single use.
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      payload: { phone, code: devCode, deviceId: 'phone-1' },
    });
    expect(again.statusCode).toBe(401);

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${signedIn.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(signedIn.user.id);

    const anonymous = await app.inject({ method: 'GET', url: '/api/me' });
    expect(anonymous.statusCode).toBe(401);
    const badToken = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(badToken.statusCode).toBe(401);
  });

  it('accepts a phone typed the local way and rejects what is not a phone', async () => {
    const local = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      payload: { phone: '09 123 456 789' },
    });
    // The API wants E.164; the app normalises before asking.
    expect(local.statusCode).toBe(400);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      payload: { phone: 'hello' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('creates a business for the signed-in owner and keeps strangers out', async () => {
    const owner = new ApiClient(app);
    const { accounts } = await owner.createBusiness();
    expect(accounts.length).toBeGreaterThan(0);
    const me = await owner.ok<{ businesses: { business: { id: string }; role: string }[] }>(
      'GET',
      '/me',
    );
    expect(me.businesses).toEqual([
      expect.objectContaining({ business: expect.objectContaining({ id: owner.businessId }) }),
    ]);
    expect(me.businesses[0]?.role).toBe('owner');

    const stranger = new ApiClient(app);
    await stranger.signIn();
    const peek = await stranger.request('GET', `/businesses/${owner.businessId}/accounts`);
    expect(peek.statusCode).toBe(403);
    const pull = await stranger.request('GET', `/sync/pull?businessId=${owner.businessId}&since=0`);
    expect(pull.statusCode).toBe(403);
    const push = await stranger.request('POST', '/sync/push', {
      businessId: owner.businessId,
      mutations: [],
    });
    expect(push.statusCode).toBe(403);
  });

  it('lets an owner invite a phone, and that phone join and record a sale', async () => {
    const owner = new ApiClient(app);
    await owner.createBusiness();
    const helperPhone = testPhone();

    const invite = await owner.ok<{ id: string; status: string }>(
      'POST',
      `/businesses/${owner.businessId}/invites`,
      { phone: helperPhone, name: 'Ma Hla' },
    );
    expect(invite.status).toBe('pending');
    const list = await owner.ok<{ members: unknown[]; invites: unknown[] }>(
      'GET',
      `/businesses/${owner.businessId}/members`,
    );
    expect(list.members).toHaveLength(1);
    expect(list.invites).toHaveLength(1);

    // The invited person signs in on their own phone and sees the invite.
    const helper = new ApiClient(app, helperPhone);
    const signedIn = await helper.signIn('phone-2');
    const pending = (signedIn as unknown as { invites: { id: string; invitedByName: string }[] })
      .invites;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(invite.id);
    expect(pending[0]?.invitedByName).toBe('Owner');

    // Someone else cannot take the invite.
    const other = new ApiClient(app);
    await other.signIn();
    const stolen = await other.request('POST', `/invites/${invite.id}/accept`);
    expect(stolen.statusCode).toBe(403);

    const joined = await helper.ok<{ business: { id: string }; role: string }>(
      'POST',
      `/invites/${invite.id}/accept`,
    );
    expect(joined.business.id).toBe(owner.businessId);
    expect(joined.role).toBe('member');
    const helperMe = await helper.ok<{ user: { name: string } }>('GET', '/me');
    expect(helperMe.user.name).toBe('Ma Hla');

    // The member records a sale through sync, as a phone would.
    const docId = newId();
    const pushed = await helper.ok<{ accepted: string[]; rejected: unknown[] }>(
      'POST',
      '/sync/push',
      {
        businessId: owner.businessId,
        mutations: [
          {
            id: newId(),
            entity: 'document',
            entityId: docId,
            op: 'upsert',
            clientAt: '2026-04-10T06:00:00Z',
            deviceId: 'phone-2',
            data: {
              businessId: owner.businessId,
              type: 'sale',
              date: '2026-04-10',
              moneyAccountId: owner.cash,
              lines: [helper.line({ amount: 5000, description: 'tea' })],
              allocations: [],
              total: 5000,
              createdByUserId: helper.userId,
              deviceId: 'phone-2',
              createdAt: '2026-04-10T06:00:00Z',
              updatedAt: '2026-04-10T06:00:00Z',
            },
          },
        ],
      },
    );
    expect(pushed.rejected).toEqual([]);
    expect(pushed.accepted).toHaveLength(1);
    const seen = await owner.ok<{ documents: { id: string }[] }>(
      'GET',
      `/businesses/${owner.businessId}/documents`,
    );
    expect(seen.documents.map((d) => d.id)).toContain(docId);

    // Members cannot manage people or the accounting mode; owners can.
    const memberInvite = await helper.request('POST', `/businesses/${owner.businessId}/invites`, {
      phone: testPhone(),
    });
    expect(memberInvite.statusCode).toBe(403);
    const memberMode = await helper.request(
      'PUT',
      `/businesses/${owner.businessId}/accounting-mode`,
      { mode: 'accrual' },
    );
    expect(memberMode.statusCode).toBe(403);

    // The last owner stays; a member can be removed.
    const lastOwner = await owner.request(
      'DELETE',
      `/businesses/${owner.businessId}/members/${owner.userId}`,
    );
    expect(lastOwner.statusCode).toBe(409);
    await owner.ok('DELETE', `/businesses/${owner.businessId}/members/${helper.userId}`);
    const after = await helper.request('GET', `/businesses/${owner.businessId}/accounts`);
    expect(after.statusCode).toBe(403);
  });

  it('signs a device out and the token stops working', async () => {
    const c = new ApiClient(app);
    await c.signIn('phone-a');
    const tokenA = c.token;
    await c.signIn('phone-b');
    const tokenB = c.token;
    expect(tokenA).not.toBe(tokenB);

    const others = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out-others',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(others.json().count).toBe(1);
    const a = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(a.statusCode).toBe(401);

    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(out.statusCode).toBe(204);
    const b = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(b.statusCode).toBe(401);
  });

  it('stops after too many codes for one phone', async () => {
    const phone = testPhone();
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/request-code',
        payload: { phone },
      });
      expect(r.statusCode).toBe(200);
    }
    const sixth = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      payload: { phone },
    });
    expect(sixth.statusCode).toBe(429);
  });
});
