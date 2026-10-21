# Accounting core and inventory

Status: built in the "Core accounting and inventory" thread, 21 October 2026.
Implements the [product scope and accounting model](https://claude.ai/artifact/J4NiDmKopJT6BsropxtHYs)
on the [architecture](./architecture.md). This page is the contract the mobile
UI thread builds against.

## Where things live

| Piece | Where | Why there |
| --- | --- | --- |
| Chart of accounts, system account codes | `packages/core/src/accounting/chart.ts` | The device seeds and displays the same chart |
| Posting rules (document to journal entries and stock movements) | `packages/core/src/accounting/posting.ts` | Pure; the device can show correct balances offline |
| Weighted average costing engine | `packages/core/src/accounting/costing.ts` | Same |
| Oldest-first allocation, fiscal periods, report shaping | `packages/core/src/accounting/{allocation,fiscal,reports}.ts` | Same |
| Ledger service (write a document, repost, recost, settle) | `apps/api/src/services/ledger.ts` | Needs the database |
| Reports (SQL sums by account, then core shaping) | `apps/api/src/services/reports.ts` | Needs the database |
| REST routes | `apps/api/src/routes/businesses.ts` | |
| Sync push applies mutations through the same services | `apps/api/src/routes/sync.ts` | A pushed sale posts exactly like a saved one |
| Schema and migration | `apps/api/src/db/schema/index.ts`, `apps/api/drizzle/0001_accounting_core.sql` | |

## The two journals in practice

Every journal entry has a basis: `accrual`, `cash` or `both`. Reports in cash
mode read `cash` + `both`; in accrual mode `accrual` + `both`. The mode switch
(`PUT /accounting-mode`) changes the business setting, writes an audit row and
nothing else.

| Document | Entries |
| --- | --- |
| Sale paid now | One entry, basis `both`: money account (less any wallet fee), Sales (or the line's income account), Tax collected, Cost of goods sold against Stock on hand for stocked items |
| Sale on credit | Same lines with Customers owe me instead of money, basis `accrual` |
| Purchase or expense paid now | Basis `both`: Stock on hand (stocked item), Purchases (item not tracked) or the chosen account, against money |
| Purchase or expense unpaid | Same with Suppliers I owe, basis `accrual` |
| Payment in or out | Basis `both`: money against Customers owe me or Suppliers I owe for the allocated amount; the excess goes to Advances. Plus one basis `cash` entry per settled document: that document's accrual lines scaled to the amount paid, so cash-basis income, expense and cost of goods sold arrive in proportion. An advance posts a cash-basis Sales (or Purchases) line on receipt |
| Owner money in or out, transfer (fee to Bank and payment fees), stock adjustment | Basis `both` |
| Opening balance | Basis `both` against Opening balance adjustment, except opening receivables and payables, which are `accrual` so cash-basis reports see them only when collected or paid |

Pro rata rounding: each line's cumulative cash share is floor(line x paid /
total). The receivable line tracks the paid amount exactly and the largest line
on the other side absorbs the remainder, so every entry balances, the cash
journal never exceeds the accrual journal, and the two match exactly once the
document is fully paid (tests in `posting.test.ts`).

Editing or deleting a document deletes its derived rows and rebuilds them.
Items it touched are recosted; sales whose cost of goods sold changed are
reposted; payments against any reposted document are reposted too. Every
derived row change is appended to the sync change log.

## Inventory

- Stock movements are derived from documents: purchase and opening stock in at
  the typed cost, sale out, adjustment either way.
- `stock_movements.value` is the signed whole-kyat amount the Stock on hand
  account moves by. Outbound values come from the costing engine, which runs
  all of an item's movements in date order (then document id, then id).
- `items.quantity_on_hand_milli`, `items.stock_value`, `items.average_cost`
  and `items.last_cost` are caches written by the engine. The client never
  sends them; `PUT /items/:id` ignores them.
- Stock on hand in the accrual journal equals the sum of item stock values
  exactly. Quantity x average cost can differ by rounding.
- Negative stock is allowed. The sale is valued at the last known average
  cost, the response carries a `negative_stock` warning, and the next purchase
  absorbs the difference in the item's value. The earlier sale's cost of goods
  sold is not rewritten (see decisions below).
- A purchase dated before existing sales sorts before them, so those sales are
  recosted and reposted.

## REST API

All routes are under `/api/businesses/:businessId`, read the acting user from
the bearer session token (see sign-in.md), and use the `@cannopy/core`
types for bodies and replies. Ids are UUID v7 made by the client. `PUT` is an
upsert: send the whole row.

| Method and path | Body / query | Reply |
| --- | --- | --- |
| `POST /api/businesses` | `{ business: Business, owner: User }` | 201 `{ business, owner, accounts }` with the standard chart |
| `GET /:businessId` | | `Business` |
| `PUT /:businessId/accounting-mode` | `{ mode: 'cash' \| 'accrual' }` | `Business` |
| `GET /:businessId/accounts` | | `{ accounts: Account[] }` |
| `PUT /:businessId/accounts/:id` | `Account` (owner picks `ownerGroup` and `name`; code and type are assigned; system accounts only change name, hidden, provider, defaultFee) | `Account` |
| `DELETE /:businessId/accounts/:id` | | 204; 409 for system accounts or accounts with postings |
| `GET` / `PUT` / `DELETE /:businessId/contacts/:id` | `Contact` | |
| `GET /:businessId/contacts/:id/open-documents` | | `{ documents: [{ documentId, type, number, date, total, paidAmount, balance }] }` oldest first, for Get paid and Pay supplier |
| `GET` / `PUT` / `DELETE /:businessId/items/:id` | `Item` | |
| `GET /:businessId/documents` | `?type&contactId&from&to&limit` | `{ documents: Document[] }` newest first |
| `GET /:businessId/documents/:id` | | `{ document, journalEntries, stockMovements }` |
| `PUT /:businessId/documents/:id` | `Document` | `{ document, warnings }`; `document` carries the server-assigned `number`, `paidAmount` and `status` |
| `DELETE /:businessId/documents/:id` | | `{ document }` (soft deleted, status `void`); 409 `has_payments` if payments settle it |
| `GET /:businessId/reports/profit-and-loss` | `?from&to` or `?period=fiscal_year`, `&basis=` | income, cost of sales, expenses by account and totals |
| `GET /:businessId/reports/balance-sheet` | `?asOf&basis=` | the six owner groups, profit to date, totals and a zero `difference` |
| `GET /:businessId/reports/money` | `?date` | every money account's balance, today's in and out |
| `GET /:businessId/reports/receivables`, `/payables` | | per contact: balance, oldest open date, open documents |
| `GET /:businessId/reports/stock` | | per item: quantity, average cost, value, low stock, negative, last sold |

`basis` defaults to the business's accounting mode. Errors are
`{ error, message, details? }`: 400 for a malformed body, 404 unknown ids,
409 for conflicts, 422 when the posting rules refuse (`contact_required`,
`total_mismatch`, `over_allocation`, `unknown_item`, ...).

### Document shapes the UI sends

- Sale: `lines[].itemId` or `accountId` (income account; default Sales), `quantityMilli`, `amount`, `taxAmount`; `total` = sum of amount + tax; `moneyAccountId` when paid now (with optional `feeAmount` deducted), `contactId` when on credit.
- Purchase and expense: same, `moneyAccountId` or `contactId`; stocked items go to stock, other items to Purchases, account lines to that account. `feeAmount` is charged on top.
- Payment in / out: `contactId`, `moneyAccountId`, `total` (what the contact paid or received), `allocations[]` of `{ documentId, amount }` against that contact's open documents; what is not allocated becomes an advance. The device can compute the default split with `allocateOldestFirst` from core.
- Owner in / out: `moneyAccountId`, `total`.
- Transfer: `moneyAccountId` (from), `toMoneyAccountId`, `total`, `feeAmount`.
- Stock adjustment: `lines[].itemId`, signed `quantityMilli`, `amount` for a positive adjustment (its cost), optional `accountId` (expense reason; default Stock loss or gain).
- Opening balance: account lines with `amount` (money, equipment, loans, owner capital) and item lines (`quantityMilli`, `amount`). An opening customer or supplier balance is its own document with `contactId` and one Customers owe me or Suppliers I owe line.

### Sync

`POST /api/sync/push` applies `account`, `contact`, `item` and `document`
mutations through the same services; `journal_entry` and `stock_movement`
mutations are rejected as server-owned. Every push appends to the change log:
the document as the server now holds it (number, status, paid amount), its
journal entries (with lines), its stock movements, recosted items, and any
other documents that were reposted. Devices apply the log in order.

## Decisions made here that the scope doc did not settle

Flagged for the owner; each has a default that can be changed.

1. **Bank and payment fees (6080) is a system account.** The scope lists it as editable, but transfers and wallet cash-outs post fees to it by code, so it cannot be deleted. It can still be renamed.
2. **Opening receivables and payables post with basis accrual, not both.** Otherwise they would sit on the cash-basis balance sheet, which the scope says excludes receivables. Collecting one credits Opening balance adjustment in the cash journal, not Sales.
3. **Cash-basis stock value.** Following the scope's table (cost of goods sold reaches the cash journal when the sale is paid; a credit purchase reaches it when paid), the Stock line of the cash-basis balance sheet is stock paid for less cost recognised on paid sales. It differs from the My stock report (quantity x average cost) while sales or purchases are unpaid. The accrual balance sheet and the My stock report always agree.
4. **Negative stock correction.** The scope says the app "corrects the cost of goods sold when the purchase arrives". The engine instead lets the purchase absorb the difference in the item's value, keeps the earlier sale's cost as posted and returns a warning. Rewriting an earlier sale when a later-dated purchase arrives needs a rule for which purchases count, so it is left for the owner to decide.
5. **Applying an advance to a later sale is not implemented.** Overpayments become advances (both journals) and count as cash-basis income on receipt, as the scope says. There is no document yet that applies a held advance against a new sale; the owner would record the sale on credit and a payment in. Needs a decision on how the UI should present it.
6. **One payment method per sale.** A sale is either paid in full from one money account or on credit; part payment at the time of sale is a credit sale plus a payment in.
7. **Supplier advances** mirror customer advances: a payment out beyond what is owed books Advances I paid to suppliers and a cash-basis Purchases line.
8. **Tax on purchases** is added to the cost of the line (no input tax account), since the scope only models a 5% commercial tax collected on sales.
9. **Deleting a document that payments settle is refused** (409 `has_payments`); the payment must be edited or deleted first. Deleting is a soft delete that reverses the postings.
10. **Discounts given (4200)** exists in the chart but no document field posts to it yet; a discount can be entered as a sale line against that account with a lower total. A proper discount field is a UI question.
11. **Profit kept in the business (3200)** is not posted to: there is no year-end close. The balance sheet shows profit to date under Owner from the income and cost accounts.

## Running the tests

`pnpm test` runs the posting, costing, chart and report tests in
`packages/core` without a database. The API scenario tests in
`apps/api/src/ledger.test.ts` need `TEST_DATABASE_URL` (see
`docs/local-development.md`); they create a business, trade for a month, pay
in parts, switch modes, backdate a purchase and edit a sale, checking the
invariants from the scope doc after each step.
