import {
  type Business,
  type BusinessAccess,
  type Invite,
  type Me,
  type Member,
  type MemberRole,
  newId,
  type PendingInvite,
} from '@cannopy/core';
import { and, asc, eq } from 'drizzle-orm';
import { businesses, invites, memberships, users } from '../db/schema/index.js';
import { businessRowToCore } from './books.js';
import { ApiError, notFound } from './errors.js';
import type { Tx } from './tx.js';

/**
 * Who belongs to which business. The founder is the owner; owners invite by
 * phone number, and the invited person sees the invite as soon as they sign
 * in with that number. Members and owners have the same access to the books;
 * only owners manage people and the accounting mode (the one trivial split).
 */

export async function membershipOf(
  tx: Tx,
  businessId: string,
  userId: string,
): Promise<{ role: MemberRole } | null> {
  const [row] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function requireMember(
  tx: Tx,
  businessId: string,
  userId: string,
): Promise<MemberRole> {
  const m = await membershipOf(tx, businessId, userId);
  if (!m) throw new ApiError(403, 'not_a_member', 'You do not belong to this business');
  return m.role;
}

export async function requireOwner(tx: Tx, businessId: string, userId: string): Promise<void> {
  const role = await requireMember(tx, businessId, userId);
  if (role !== 'owner') throw new ApiError(403, 'owner_only', 'Only an owner can do this');
}

/** The signed-in user, their businesses and the invites waiting for their phone. */
export async function loadMe(tx: Tx, userId: string): Promise<Me> {
  const [user] = await tx
    .select({ id: users.id, phone: users.phone, name: users.name, language: users.language })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw notFound('User', userId);

  const rows = await tx
    .select({ business: businesses, role: memberships.role })
    .from(memberships)
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.joinedAt));
  const access: BusinessAccess[] = rows.map((r) => ({
    business: businessRowToCore(r.business),
    role: r.role,
  }));

  const pending = await tx
    .select({
      id: invites.id,
      role: invites.role,
      createdAt: invites.createdAt,
      business: businesses,
      invitedByName: users.name,
      invitedByPhone: users.phone,
    })
    .from(invites)
    .innerJoin(businesses, eq(businesses.id, invites.businessId))
    .innerJoin(users, eq(users.id, invites.invitedByUserId))
    .where(and(eq(invites.phone, user.phone), eq(invites.status, 'pending')))
    .orderBy(asc(invites.createdAt));
  const already = new Set(access.map((a) => a.business.id));
  const pendingInvites: PendingInvite[] = pending
    .filter((p) => !already.has(p.business.id))
    .map((p) => {
      const b = businessRowToCore(p.business);
      return {
        id: p.id,
        business: { id: b.id, name: b.name, type: b.type },
        invitedByName: p.invitedByName || p.invitedByPhone,
        role: p.role,
        createdAt: p.createdAt.toISOString(),
      };
    });

  return { user, businesses: access, invites: pendingInvites };
}

export async function updateMe(
  tx: Tx,
  userId: string,
  patch: { name?: string | undefined; language?: 'en' | 'my' | undefined },
): Promise<void> {
  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.language !== undefined) set.language = patch.language;
  await tx.update(users).set(set).where(eq(users.id, userId));
}

export async function addMembership(
  tx: Tx,
  businessId: string,
  userId: string,
  role: MemberRole,
  invitedByUserId: string | null,
  at: Date,
): Promise<void> {
  await tx
    .insert(memberships)
    .values({ businessId, userId, role, invitedByUserId, joinedAt: at })
    .onConflictDoNothing();
}

export async function listMembers(
  tx: Tx,
  businessId: string,
): Promise<{ members: Member[]; invites: Invite[] }> {
  const rows = await tx
    .select({
      userId: users.id,
      name: users.name,
      phone: users.phone,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.businessId, businessId))
    .orderBy(asc(memberships.joinedAt));
  const pending = await tx
    .select()
    .from(invites)
    .where(and(eq(invites.businessId, businessId), eq(invites.status, 'pending')))
    .orderBy(asc(invites.createdAt));
  return {
    members: rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() })),
    invites: pending.map(inviteRowToCore),
  };
}

export async function createInvite(
  tx: Tx,
  input: { businessId: string; phone: string; name: string; role: MemberRole; byUserId: string },
): Promise<Invite> {
  const [existingUser] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, input.phone))
    .limit(1);
  if (existingUser && (await membershipOf(tx, input.businessId, existingUser.id))) {
    throw new ApiError(409, 'already_member', 'This phone already belongs to the business');
  }
  // One pending invite per phone per business: a repeat just refreshes it.
  await tx
    .update(invites)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(invites.businessId, input.businessId),
        eq(invites.phone, input.phone),
        eq(invites.status, 'pending'),
      ),
    );
  const [row] = await tx
    .insert(invites)
    .values({
      id: newId(),
      businessId: input.businessId,
      phone: input.phone,
      name: input.name,
      role: input.role,
      invitedByUserId: input.byUserId,
    })
    .returning();
  if (!row) throw new Error('Invite was not stored');
  return inviteRowToCore(row);
}

export async function revokeInvite(tx: Tx, businessId: string, inviteId: string): Promise<void> {
  const rows = await tx
    .update(invites)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(invites.id, inviteId),
        eq(invites.businessId, businessId),
        eq(invites.status, 'pending'),
      ),
    )
    .returning({ id: invites.id });
  if (rows.length === 0) throw notFound('Invite', inviteId);
}

/** The invited person joins. Their phone must be the one the invite names. */
export async function acceptInvite(
  tx: Tx,
  inviteId: string,
  userId: string,
): Promise<{ business: Business; role: MemberRole }> {
  const [row] = await tx.select().from(invites).where(eq(invites.id, inviteId)).limit(1);
  if (!row || row.status !== 'pending') throw notFound('Invite', inviteId);
  const [user] = await tx
    .select({ phone: users.phone, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.phone !== row.phone) {
    throw new ApiError(403, 'not_invited', 'This invite is for a different phone number');
  }
  const now = new Date();
  await tx
    .update(invites)
    .set({ status: 'accepted', acceptedAt: now, acceptedByUserId: userId })
    .where(eq(invites.id, inviteId));
  await addMembership(tx, row.businessId, userId, row.role, row.invitedByUserId, now);
  // The inviter's name for this person is a fair default until they set their own.
  if (!user.name && row.name) await updateMe(tx, userId, { name: row.name });
  const [b] = await tx.select().from(businesses).where(eq(businesses.id, row.businessId)).limit(1);
  if (!b) throw notFound('Business', row.businessId);
  return { business: businessRowToCore(b), role: row.role };
}

/** Removes a member. The last owner cannot be removed, so a business is never orphaned. */
export async function removeMember(tx: Tx, businessId: string, userId: string): Promise<void> {
  const current = await membershipOf(tx, businessId, userId);
  if (!current) throw notFound('Member', userId);
  if (current.role === 'owner') {
    const owners = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), eq(memberships.role, 'owner')));
    if (owners.length <= 1) {
      throw new ApiError(409, 'last_owner', 'A business needs at least one owner');
    }
  }
  await tx
    .delete(memberships)
    .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId)));
}

export async function setMemberRole(
  tx: Tx,
  businessId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  const current = await membershipOf(tx, businessId, userId);
  if (!current) throw notFound('Member', userId);
  if (current.role === 'owner' && role !== 'owner') {
    const owners = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), eq(memberships.role, 'owner')));
    if (owners.length <= 1) {
      throw new ApiError(409, 'last_owner', 'A business needs at least one owner');
    }
  }
  await tx
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId)));
}

function inviteRowToCore(r: typeof invites.$inferSelect): Invite {
  return {
    id: r.id,
    businessId: r.businessId,
    phone: r.phone,
    name: r.name,
    role: r.role,
    invitedByUserId: r.invitedByUserId,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
  };
}
