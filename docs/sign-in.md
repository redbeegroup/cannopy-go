# Sign-in and joining a business

Status: built in the "Sign-in and joining a business" thread, 21 October 2026,
on top of the [mobile UI](./mobile-ui.md). This page says how a person signs
in, how a second phone or a second person gets the same books, what the server
stores, and which product decisions were taken that the
[scope doc](https://claude.ai/artifact/J4NiDmKopJT6BsropxtHYs) (owner only in
version 1) did not settle.

## What the owner gets

- **Sign in with a phone number.** Language, number, the six-digit code from
  the text message, and a name the first time. No password. The code lives
  ten minutes and allows five wrong tries; a number can ask for five codes an
  hour.
- **Same books on another phone, tablet or browser.** Sign in with the same
  number, tap the business under "Open", and the books are pulled from the
  server. Both devices then sync through the same outbox and change log as
  before; nothing in the offline design changed.
- **A second person.** Under Settings, People, an owner types the other
  person's phone number (and a name, optional). When that number signs in,
  the business is waiting under "You were invited to"; one tap joins.
  Members see and record everything. Only owners invite or remove people
  and switch cash or accrual (the one role split, because it was trivial).
- **Stays offline-first.** The session token is kept on the device and only
  checked when syncing. If the server stops accepting it (signed out
  elsewhere, removed from the business, a year without signing in), the
  home screen says "Sign in again to sync" and every record stays on the
  phone until the person signs in with the same number.
- **Sign out** wipes the phone's copy; the server keeps everything synced.
  **Switch business** keeps the sign-in and drops the books for the other
  business's books.

## Getting the code without an SMS provider

Sign-in only ever calls `SmsSender.send` (`apps/api/src/services/sms.ts`).
`SMS_PROVIDER` picks the implementation:

| Setting | What happens | Use |
| --- | --- | --- |
| `SMS_PROVIDER=log` (default) | The message, code included, is written to the API log at info level: `SMS to +959...: Your Cannopy GO sign-in code is 482913` | UAT today: read the code in the api container's log in Portainer |
| `SMS_PROVIDER=webhook` with `SMS_WEBHOOK_URL` (and optional `SMS_WEBHOOK_TOKEN` sent as a bearer token) | `POST {"to":"+959...","text":"...","language":"my"}` as JSON; a non-2xx answer fails the request | Any gateway that takes an HTTP call: an n8n flow, a local operator's API, a phone running an SMS gateway app |
| `AUTH_DEV_CODE=123456` | Every code equals this value and nothing is sent; the API logs a warning at start | Testing on a real phone against UAT without reading logs. Never on a host with real data |

Outside production (`NODE_ENV` not `production`) the request-code reply also
carries the code and the sign-in screen shows it, so local development needs
no log reading. A real provider later is one more case in `createSmsSender`.

These four variables are in both compose files with safe defaults (`log`,
empty, empty, unset); the UAT stack needs nothing new to keep working.

## What the server stores

| Table | Holds |
| --- | --- |
| `users` | One row per phone number (E.164, `+959...`), name, language, last sign-in. No password column |
| `memberships` | `(business_id, user_id, role)`; the founder is `owner`, invited people `member` by default |
| `auth_codes` | HMAC of each code, expiry, wrong-try count, consumed time. Only the newest unconsumed code per phone counts |
| `sessions` | HMAC of the device token, device id and name, last seen, expiry (365 days, extended on use), revoked time |
| `invites` | Business, phone, the name the inviter gave, role, status (pending, accepted, revoked) |

Tokens and codes are hashed with `AUTH_SECRET`; a copy of the database hands
out neither. Migration `0002_sign_in` carries existing users over as owners of
the business they were created with.

## API

| Route | Body | Reply |
| --- | --- | --- |
| `POST /api/auth/request-code` | `{ phone, language? }` (phone in E.164; the app normalises `09...`, `+95 9...`, Myanmar digits with `normalizePhone` from core) | `{ phone, expiresInSeconds, devCode? }`; 429 `too_many_codes` |
| `POST /api/auth/verify-code` | `{ phone, code, deviceId, deviceName?, language? }` | `{ token, isNewUser, user, businesses: [{ business, role }], invites: [{ id, business, invitedByName, role }] }`; 401 `wrong_code` or `code_expired` |
| `GET /api/me`, `PUT /api/me { name?, language? }` | | same shape without `token` |
| `POST /api/auth/sign-out`, `POST /api/auth/sign-out-others` | | 204; `{ count }` |
| `POST /api/businesses` | `{ business }` (the caller becomes owner) | `{ business, role, accounts }` |
| `GET /api/businesses/:id/members` | | `{ members: [{ userId, name, phone, role, joinedAt }], invites: [...] }` |
| `POST /api/businesses/:id/invites` | `{ phone, name?, role? }` (owner) | `Invite` 201; 409 `already_member` |
| `DELETE /api/businesses/:id/invites/:inviteId` | (owner) | 204 |
| `PUT /api/businesses/:id/members/:userId` | `{ role }` (owner) | 204; 409 `last_owner` |
| `DELETE /api/businesses/:id/members/:userId` | (owner, or oneself) | 204; 409 `last_owner` |
| `POST /api/invites/:id/accept` | (the invited phone's user) | `{ business, role }`; 403 `not_invited` |

Every other route under `/api/businesses/:businessId`, and `/api/sync/*`,
needs `Authorization: Bearer <token>` and membership of that business
(401 `unauthenticated`, 403 `not_a_member`). The `x-dev-user-id` header is
gone.

## On the device

- `Auth` (token and user) and `Session` (plus business and role) live in the
  meta table (`apps/web/src/db/local.ts`). `SessionProvider` sets the token
  on the API client and starts sync when a business is open.
- `SyncClient` sends the bearer token; a 401 or 403 becomes `SyncAuthError`,
  `SyncManager` sets `needsSignIn` and stops retrying until `start` is called
  again after a new sign-in. The sync chip, Settings and the Sync screen all
  point to `/sign-in?again=1`.
- Signing in again with a number that still belongs to the open business
  keeps the local books and only replaces the token. Any other outcome goes
  to `/choose`.
- Opening a business the phone has never held clears the previous business's
  rows and pulls the change log before showing Home, so it is never empty.

## Decisions made here that the scope doc did not settle

Flagged for the owner; each has a default that can be changed.

1. **Phone number is the only login.** No email, no password. Confirmed as
   the default in architecture decision 8.
2. **Two roles, same books.** Owner and member see and record the same
   things; owners alone manage people and the cash/accrual switch. A cashier
   role that hides profit or money would be a later, separate piece.
3. **Invites are by phone number, not by code or link.** Nothing to copy or
   forward; a typo means revoke and invite again. The invited person must
   sign in with exactly that number.
4. **A removed person keeps the copy on their phone** until they sign out.
   Removal stops them syncing at once (next sync is refused and the phone
   says "Sign in again"), but offline-first means the records already on the
   device stay readable. If that matters, the next step is a server flag that
   makes the app wipe itself on the next refused sync.
5. **Sessions last a year** and are extended on use, so a phone that is
   only occasionally online stays signed in. Sign out from the device, or
   "sign out other devices" from the API, revokes them.
6. **Names.** A new number is asked for a name once at sign-in. The name an
   inviter typed is shown on the inviter's People list until the person
   joins; it is only copied to the person if they have no name of their own.
7. **Code delivery on UAT is the API log** until an SMS gateway is chosen.
   The webhook provider exists so an n8n flow or a local operator API can be
   plugged in without a code change.
8. **One pending invite per phone per business.** Inviting the same number
   again replaces the earlier invite.

## Checking it by hand

```bash
docker compose up -d db && pnpm db:migrate && pnpm dev
```

Open http://localhost:5173 on a phone-sized window, choose a language, type
`09 123 456 789`, send the code (it appears on screen in development), type
your name, start a business. Open a second private window as a tablet, sign
in with the same number, tap Open: the opening cash is there. In the first
window go to Settings, People, invite `09 777 888 999`; in a third window
sign in with that number and tap Join. Remove that person from the first
window; the third window's home screen says "Sign in again to sync" on its
next sync and keeps showing the books.
