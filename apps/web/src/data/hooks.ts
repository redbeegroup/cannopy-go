import {
  type Account,
  type AccountingMode,
  balanceSheet,
  balancesFromJournal,
  type Contact,
  contactOpenBalances,
  type Document,
  type Item,
  moneyBalances,
  openBalances,
  profitAndLoss,
} from '@cannopy/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { localDb } from '../db/local';

/**
 * Live reads from the working copy. Every hook re-renders when the underlying
 * IndexedDB rows change, whether the owner wrote them or a pull brought them.
 */

const EMPTY: never[] = [];

export function useAccounts(): Account[] {
  return (
    useLiveQuery(() => localDb.accounts.filter((a) => !a.deletedAt).sortBy('code'), []) ?? EMPTY
  );
}

export function useMoneyAccounts(): Account[] {
  const accounts = useAccounts();
  return useMemo(() => accounts.filter((a) => a.moneyKind && !a.isHidden), [accounts]);
}

export function useContacts(): Contact[] {
  return useLiveQuery(() => localDb.contacts.filter((c) => !c.deletedAt).toArray(), []) ?? EMPTY;
}

export function useContact(id: string | undefined): Contact | undefined {
  return useLiveQuery(() => (id ? localDb.contacts.get(id) : undefined), [id]);
}

export function useItems(): Item[] {
  return useLiveQuery(() => localDb.items.filter((i) => !i.deletedAt).toArray(), []) ?? EMPTY;
}

export function useItem(id: string | undefined): Item | undefined {
  return useLiveQuery(() => (id ? localDb.items.get(id) : undefined), [id]);
}

/** Every live document, newest first. Void ones are kept out. */
export function useDocuments(): Document[] {
  return (
    useLiveQuery(
      () =>
        localDb.documents
          .orderBy('date')
          .reverse()
          .filter((d) => !d.deletedAt && d.status !== 'void')
          .toArray(),
      [],
    ) ?? EMPTY
  );
}

export function useDocument(id: string | undefined): Document | undefined {
  return useLiveQuery(() => (id ? localDb.documents.get(id) : undefined), [id]);
}

/** Balance of every money account, computed from documents, including unsynced ones. */
export function useMoneyBalances(): { byAccount: Map<string, number>; total: number } {
  const docs = useDocuments();
  const accounts = useAccounts();
  return useMemo(() => {
    const byAccount = moneyBalances(docs, accounts);
    let total = 0;
    for (const v of byAccount.values()) total += v;
    return { byAccount, total };
  }, [docs, accounts]);
}

/** Who owes me and who I owe, from the documents on the device. */
export function useOpenBalances() {
  const docs = useDocuments();
  const accounts = useAccounts();
  return useMemo(() => {
    const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
    const open = openBalances(docs, (id) => codeOf.get(id));
    const receivable = contactOpenBalances(open, 'receivable');
    const payable = contactOpenBalances(open, 'payable');
    return {
      open,
      receivable,
      payable,
      owedToMe: receivable.reduce((s, r) => s + r.balance, 0),
      iOwe: payable.reduce((s, r) => s + r.balance, 0),
    };
  }, [docs, accounts]);
}

/** Profit and loss from the journal entries pulled so far. */
export function useProfitAndLoss(mode: AccountingMode, from: string, to: string) {
  const accounts = useAccounts();
  const entries =
    useLiveQuery(
      () => localDb.journalEntries.where('date').between(from, to, true, true).toArray(),
      [from, to],
    ) ?? EMPTY;
  return useMemo(
    () => profitAndLoss(balancesFromJournal(entries, accounts, mode, { from, to })),
    [entries, accounts, mode, from, to],
  );
}

/** Balance sheet as of a date, from the journal entries pulled so far. */
export function useBalanceSheet(mode: AccountingMode, asOf: string) {
  const accounts = useAccounts();
  const entries =
    useLiveQuery(() => localDb.journalEntries.where('date').belowOrEqual(asOf).toArray(), [asOf]) ??
    EMPTY;
  return useMemo(
    () => balanceSheet(balancesFromJournal(entries, accounts, mode, { to: asOf })),
    [entries, accounts, mode, asOf],
  );
}

export function useStockSummary() {
  const items = useItems();
  return useMemo(() => {
    const stocked = items.filter((i) => i.type === 'stocked');
    return {
      items: stocked,
      totalValue: stocked.reduce((s, i) => s + i.stockValue, 0),
      low: stocked.filter(
        (i) => i.lowStockLevelMilli !== null && i.quantityOnHandMilli <= i.lowStockLevelMilli,
      ),
      negative: stocked.filter((i) => i.quantityOnHandMilli < 0),
    };
  }, [items]);
}
