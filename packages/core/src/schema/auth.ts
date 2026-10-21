import { z } from 'zod';
import { languageSchema } from '../i18n/label.js';
import { idSchema } from '../ids/id.js';
import { businessSchema } from './business.js';
import { isoInstantSchema } from './common.js';

/**
 * Sign-in and membership (docs/architecture.md, decision 8).
 *
 * A user is a phone number. Sign-in sends a one-time code to that phone and
 * trades it for a long-lived device session token, which the app keeps on the
 * device and sends as a bearer token when it syncs. A user belongs to zero or
 * more businesses through memberships; the person who creates a business is
 * its owner and can invite others by phone number.
 */

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Expected an international phone number like +959123456789');

export const memberRoleSchema = z.enum(['owner', 'member']);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const membershipSchema = z.object({
  businessId: idSchema,
  userId: idSchema,
  role: memberRoleSchema,
  /** Who invited this member; null for the founder. */
  invitedByUserId: idSchema.nullable().default(null),
  joinedAt: isoInstantSchema,
});
export type Membership = z.infer<typeof membershipSchema>;

/** A member as the People screen shows it. */
export const memberSchema = z.object({
  userId: idSchema,
  name: z.string(),
  phone: phoneSchema,
  role: memberRoleSchema,
  joinedAt: isoInstantSchema,
});
export type Member = z.infer<typeof memberSchema>;

export const inviteStatusSchema = z.enum(['pending', 'accepted', 'revoked']);

export const inviteSchema = z.object({
  id: idSchema,
  businessId: idSchema,
  phone: phoneSchema,
  /** What the inviter calls this person; used until they set their own name. */
  name: z.string().trim().max(120).default(''),
  role: memberRoleSchema.default('member'),
  invitedByUserId: idSchema,
  status: inviteStatusSchema,
  createdAt: isoInstantSchema,
  acceptedAt: isoInstantSchema.nullable().default(null),
});
export type Invite = z.infer<typeof inviteSchema>;

/** An invite as the invited person sees it after signing in. */
export const pendingInviteSchema = z.object({
  id: idSchema,
  business: businessSchema.pick({ id: true, name: true, type: true }),
  invitedByName: z.string(),
  role: memberRoleSchema,
  createdAt: isoInstantSchema,
});
export type PendingInvite = z.infer<typeof pendingInviteSchema>;

/* Requests and replies */

export const requestCodeBodySchema = z.object({
  phone: phoneSchema,
  language: languageSchema.optional(),
});
export type RequestCodeBody = z.infer<typeof requestCodeBodySchema>;

export const requestCodeResultSchema = z.object({
  phone: phoneSchema,
  expiresInSeconds: z.number().int().positive(),
  /** Only outside production, so the dev flow and tests need no SMS. */
  devCode: z.string().optional(),
});
export type RequestCodeResult = z.infer<typeof requestCodeResultSchema>;

export const verifyCodeBodySchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Expected a 6-digit code'),
  deviceId: z.string().trim().min(1).max(64),
  deviceName: z.string().trim().max(120).optional(),
  language: languageSchema.optional(),
});
export type VerifyCodeBody = z.infer<typeof verifyCodeBodySchema>;

export const businessAccessSchema = z.object({
  business: businessSchema,
  role: memberRoleSchema,
});
export type BusinessAccess = z.infer<typeof businessAccessSchema>;

/** What a signed-in user can do next: their businesses and the invites waiting for their phone. */
export const meSchema = z.object({
  user: z.object({
    id: idSchema,
    phone: phoneSchema,
    name: z.string(),
    language: languageSchema,
  }),
  businesses: z.array(businessAccessSchema),
  invites: z.array(pendingInviteSchema),
});
export type Me = z.infer<typeof meSchema>;

export const signInResultSchema = meSchema.extend({
  token: z.string().min(16),
  /** True when this phone had never signed in before; the app asks for a name. */
  isNewUser: z.boolean(),
});
export type SignInResult = z.infer<typeof signInResultSchema>;

export const updateMeBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  language: languageSchema.optional(),
});

export const createInviteBodySchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().max(120).default(''),
  role: memberRoleSchema.default('member'),
});

export const membersResultSchema = z.object({
  members: z.array(memberSchema),
  invites: z.array(inviteSchema),
});
export type MembersResult = z.infer<typeof membersResultSchema>;
