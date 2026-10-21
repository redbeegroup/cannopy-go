import type { Bilingual } from '../i18n/label.js';
import type { Id } from '../ids/id.js';
import type { AccountType, OwnerGroup } from '../schema/account.js';
import { isDebitNormal } from './chart.js';

/**
 * Report shaping from account balances. The API (or the device) sums journal
 * lines by account for the chosen basis and date range; these functions turn
 * those sums into the owner's reports. Pure, so both sides agree.
 */

export interface AccountBalance {
  accountId: Id;
  code: string;
  type: AccountType;
  ownerGroup: OwnerGroup;
  name: Bilingual;
  isHidden: boolean;
  debit: number;
  credit: number;
}

export interface ReportLine {
  accountId: Id;
  code: string;
  name: Bilingual;
  /** Positive in the account's natural direction: income and liabilities as credits, assets and costs as debits. */
  amount: number;
}

/** Balance in the account's natural direction. */
export function naturalBalance(b: Pick<AccountBalance, 'type' | 'debit' | 'credit'>): number {
  return isDebitNormal(b.type) ? b.debit - b.credit : b.credit - b.debit;
}

function toLines(
  balances: readonly AccountBalance[],
  keep: (b: AccountBalance) => boolean,
): ReportLine[] {
  return balances
    .filter((b) => keep(b) && (b.debit !== 0 || b.credit !== 0))
    .map((b) => ({ accountId: b.accountId, code: b.code, name: b.name, amount: naturalBalance(b) }))
    .sort((x, y) => x.code.localeCompare(y.code));
}

const sum = (lines: readonly ReportLine[]) => lines.reduce((s, l) => s + l.amount, 0);

export interface ProfitAndLoss {
  income: ReportLine[];
  costOfSales: ReportLine[];
  expenses: ReportLine[];
  totals: {
    income: number;
    costOfSales: number;
    grossProfit: number;
    expenses: number;
    netProfit: number;
  };
}

/** "Am I making money": balances must cover the report's date range only. */
export function profitAndLoss(balances: readonly AccountBalance[]): ProfitAndLoss {
  const income = toLines(balances, (b) => b.type === 'income');
  const costOfSales = toLines(balances, (b) => b.type === 'cost_of_sales');
  const expenses = toLines(balances, (b) => b.type === 'expense');
  const totals = {
    income: sum(income),
    costOfSales: sum(costOfSales),
    grossProfit: 0,
    expenses: sum(expenses),
    netProfit: 0,
  };
  totals.grossProfit = totals.income - totals.costOfSales;
  totals.netProfit = totals.grossProfit - totals.expenses;
  return { income, costOfSales, expenses, totals };
}

export const BALANCE_SHEET_GROUPS: readonly OwnerGroup[] = [
  'my_money',
  'owed_to_me',
  'stock',
  'things_i_own',
  'i_owe',
  'owner',
];

export interface BalanceSheetGroup {
  group: OwnerGroup;
  lines: ReportLine[];
  total: number;
}

export interface BalanceSheet {
  groups: BalanceSheetGroup[];
  /** Income less costs and expenses since the start of the books, shown under Owner. */
  profitToDate: number;
  totals: {
    /** My money + owed to me + stock + things I own. */
    own: number;
    /** I owe. */
    owe: number;
    /** Owner capital, drawings, profit kept and profit to date. */
    owner: number;
    /** own - owe - owner; zero when the books balance. */
    difference: number;
  };
}

/** "What my business is worth": balances must cover everything up to the as-of date. */
export function balanceSheet(balances: readonly AccountBalance[]): BalanceSheet {
  const pl = profitAndLoss(balances);
  const groups = BALANCE_SHEET_GROUPS.map((group) => {
    const lines = toLines(
      balances,
      (b) =>
        b.ownerGroup === group &&
        b.type !== 'income' &&
        b.type !== 'expense' &&
        b.type !== 'cost_of_sales',
    );
    return { group, lines, total: sum(lines) };
  });
  const totalOf = (g: OwnerGroup) => groups.find((x) => x.group === g)?.total ?? 0;
  const own =
    totalOf('my_money') + totalOf('owed_to_me') + totalOf('stock') + totalOf('things_i_own');
  const owe = totalOf('i_owe');
  const owner = totalOf('owner') + pl.totals.netProfit;
  return {
    groups,
    profitToDate: pl.totals.netProfit,
    totals: { own, owe, owner, difference: own - owe - owner },
  };
}
