# Mobile UI and onboarding

Status: built in the "Mobile UI and onboarding" thread, 21 October 2026, on top
of the [accounting core](./accounting-core.md). This page says what the web app
does on the device, how it stays correct without signal, and which product
decisions it took that the [scope doc](https://claude.ai/artifact/J4NiDmKopJT6BsropxtHYs)
did not settle.

## What the owner gets

Phone first (one column, 48px targets, bottom tabs), the same screens centred
on a tablet or desktop. Every label exists in English and Myanmar; the Myanmar
strings are a first draft in `apps/web/src/i18n/my.json` and need a native
speaker's pass before release.

| Screen | Route | What it does |
| --- | --- | --- |
| Setup | `/setup` | Language, business name and type, owner name and phone, fiscal year (April default), opening cash, bank and wallet. Four taps of Next. Needs the server once, to create the business and its chart of accounts; everything after works offline |
| Home | `/` | Sell, Spend, Get paid as big buttons; Buy stock, Pay supplier, Owner money, Move money as chips; the plain groups My money (per account), Owed to me, I owe, Stock, Owner, Money in and out this month with profit; recent records; sync state |
| Sell | `/sell`, `/sell/:id` | Items (quantity, price each) or a typed amount; paid from a money account or on credit with a customer; wallet fee; optional 5% tax when enabled |
| Spend | `/spend`, `/spend/:id` | Amount with 500/1,000/5,000/10,000 presets, plain category, paid from or "not paid yet" with a supplier |
| Buy stock | `/buy`, `/buy/:id` | Supplier, items with quantity and cost each, paid or owed |
| Get paid, Pay supplier | `/get-paid`, `/pay` | Pick the person, see what is open, type any amount, oldest-first split shown and editable, excess kept as an advance. `?contact=` preselects |
| Owner money, Move money | `/owner`, `/transfer` | Put in or take out; transfer between money accounts with the cash-out fee |
| Items | `/items`, `/items/:id` | List with stock and value; kind (stocked, not tracked, service), unit, price, low-stock level; opening stock on creation; stock count that records the difference; recent movements |
| People | `/contacts`, `/contacts/:id` | Customers and suppliers tabs with balances; detail with Get paid / Pay buttons, open documents with age, SMS reminder, history; opening balance on creation |
| History | `/history`, `/documents/:id` | Day book by date with filters; detail with lines, split, "paid by"; Edit reopens the right form; Delete reverses the postings |
| Reports | `/reports/...` | Money today, Who owes me, Who I owe, Am I making money (month, last month, fiscal year), My stock, What my business is worth. Each names the basis and links to the switch |
| Settings | `/settings/...` | Language, cash/accrual switch, money accounts (add wallets with provider and usual fee), number grouping and Myanmar digits, tax on sales, sync status with the server's rejections, start over on this phone |

## How it works on the device

- **Reads come from IndexedDB** (`apps/web/src/db/local.ts`, Dexie) through
  live queries in `apps/web/src/data/hooks.ts`. Screens never wait for the
  network.
- **Writes go through `Repo`** (`apps/web/src/data/repo.ts`): the row and its
  outbox mutation are written in one transaction, then a sync is requested.
  The screen is done when the transaction commits.
- **`SyncManager`** (`apps/web/src/sync/manager.ts`) pushes the outbox and
  pulls the change log on open, when the network returns, when the tab is
  shown, every three minutes and shortly after each write. Rejected mutations
  leave the queue and are listed under Settings, Sync, with the reason.
- **Journal entries are pulled too.** The device keeps the server's entries so
  profit and the balance sheet are computed locally with the same core report
  functions the API uses (`balancesFromJournal` in `packages/core`). A note
  says when unsynced changes are not in a report yet.
- **Money and balances never wait for sync.** `moneyEffects` and
  `openBalances` in `packages/core/src/accounting/device.ts` derive money
  account balances and who-owes-what from the documents alone, so a sale
  recorded with no signal is on the home screen at once. `moneyEffects` is
  tested against the posting rules for every document type that moves money.
- **Zawgyi is converted at input.** Every text field converts Zawgyi to
  Unicode when the owner leaves it (`apps/web/src/myanmar/zawgyi.ts`), using
  Google's myanmar-tools transliteration rules vendored into the app. The npm
  package does not ship a browser build, so detection is structural rather
  than the upstream Markov model; it never touches valid Unicode.
- **Acting user.** Until authentication lands, the owner id created at setup
  is sent as `x-dev-user-id` on every request, matching the API's placeholder.

## Decisions made here that the scope doc did not settle

Flagged for the owner; each has a default that can be changed.

1. **Setup asks five things, not everything.** Opening customers who already
   owe, suppliers owed and opening stock are entered on the People and Items
   screens when the record is created, not during setup. Setup still takes
   under five minutes.
2. **Setup needs internet once.** The API assigns the chart of accounts, so the
   business is created on the server before the first sale. The app says so
   plainly when offline. Creating the chart on the device would need a change
   to `POST /businesses`.
3. **One payment method per sale** (accounting core decision 6): the Sell
   screen offers one money account or credit. A part payment is a credit sale
   followed by Get paid.
4. **Customers can be attached to paid sales.** A sale paid on the spot may
   still name the customer, for later sales-by-customer reporting; the posting
   is unchanged.
5. **Deleting a document that payments settle is refused on the device too**,
   mirroring the server's 409, with a message to remove the payment first.
   This keeps the device and server copies the same.
6. **Display settings live on the device.** Digit grouping, Myanmar digits and
   the tax toggle are kept in the device's business copy because the API has
   no business settings route yet. Language is a device setting as well.
7. **Stock count posts at average cost.** A positive difference is valued at
   the item's current average cost; a negative one is costed by the server.
8. **Sales-by-item, day book export and receipt images** from the reports
   table are not in this pass. The data for them is on the device.
9. **Second device or reinstall.** There is no sign-in yet, so a second phone
   cannot join an existing business. This waits for the auth work (architecture
   decision 8).

## Checking it by hand

```bash
docker compose up -d db && pnpm db:migrate && pnpm dev
```

Open http://localhost:5173 on a phone-sized window, finish setup, add an item
with opening stock, sell for cash, sell on credit to a new customer, record
20,000 against it, then compare Home with
`GET /api/businesses/:id/reports/money` and `/reports/balance-sheet`. Turn the
network off, record a sale, turn it back on: the sync line goes from "Offline,
1 change saved on this phone" to "All saved and synced".
