import { fiscalYearRange, monthRange, type OwnerGroup } from '@cannopy/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  useBalanceSheet,
  useContacts,
  useDocuments,
  useMoneyAccounts,
  useMoneyBalances,
  useOpenBalances,
  useProfitAndLoss,
  useStockSummary,
} from '../data/hooks';
import { useSession } from '../data/session';
import { useSyncStatus } from '../sync/manager';
import { Choice } from '../ui/fields';
import { formatDate, formatQuantity, today, useLabel, useLanguage, useMoney } from '../ui/format';
import { Row } from '../ui/List';
import { Card, EmptyState, Screen, Section } from '../ui/Screen';

/**
 * Reports under the owner's names from the scope doc, with the accounting
 * name small underneath. Money, who owes me and who I owe come from the
 * device's documents; profit, stock and worth come from the journal pulled
 * from the server, so a note says when unsynced changes are not in yet.
 */
export function Reports() {
  const { t } = useTranslation();
  const { business } = useSession();
  const reports = [
    ['money', 'cash_position'],
    ['owed-to-me', 'receivables'],
    ['i-owe', 'payables'],
    ['profit', 'profit_and_loss'],
    ['stock', 'inventory'],
    ['worth', 'balance_sheet'],
  ] as const;
  return (
    <Screen title={t('nav.reports')}>
      <ModeLine mode={business.accountingMode} />
      <Card className="flush">
        {reports.map(([path, accounting]) => (
          <Row
            key={path}
            to={`/reports/${path}`}
            title={t(`reports.${path.replace(/-/g, '_')}`)}
            subtitle={t(`reports.accounting.${accounting}`)}
          />
        ))}
      </Card>
    </Screen>
  );
}

function ModeLine({ mode }: { mode: 'cash' | 'accrual' }) {
  const { t } = useTranslation();
  return (
    <Link to="/settings/mode" className="mode-line">
      {t('reports.mode_line', { mode: t(`mode.${mode}`) })} ›
    </Link>
  );
}

function PendingNote() {
  const { t } = useTranslation();
  const s = useSyncStatus();
  if (s.pending === 0) return null;
  return <div className="banner info">{t('reports.pending_note', { count: s.pending })}</div>;
}

export function MoneyReport() {
  const { t } = useTranslation();
  const accounts = useMoneyAccounts();
  const balances = useMoneyBalances();
  const docs = useDocuments();
  const money = useMoney();
  const pick = useLabel();
  const day = today();
  const todayFlow = useMemo(() => {
    let inn = 0;
    let out = 0;
    for (const d of docs) {
      if (d.date !== day) continue;
      if (d.type === 'sale' || d.type === 'payment_in' || d.type === 'owner_in') {
        if (d.moneyAccountId) inn += d.total - d.feeAmount;
      } else if (
        d.type === 'expense' ||
        d.type === 'purchase' ||
        d.type === 'payment_out' ||
        d.type === 'owner_out'
      ) {
        if (d.moneyAccountId) out += d.total + d.feeAmount;
      }
    }
    return { inn, out };
  }, [docs, day]);
  return (
    <Screen
      title={t('reports.money')}
      subtitle={t('reports.accounting.cash_position')}
      back="/reports"
    >
      <Card className="stat hero">
        <div className="stat-label">{t('groups.my_money')}</div>
        <div className="stat-value">{money(balances.total)}</div>
        <div className="inout">
          <div>
            <div className="muted small">{t('reports.in_today')}</div>
            <div className="in">{money(todayFlow.inn)}</div>
          </div>
          <div>
            <div className="muted small">{t('reports.out_today')}</div>
            <div className="out">{money(todayFlow.out)}</div>
          </div>
        </div>
      </Card>
      <Card className="flush">
        {accounts.map((a) => (
          <Row
            key={a.id}
            title={a.provider || pick(a.name)}
            subtitle={t(`money_kind.${a.moneyKind}`)}
            right={money(balances.byAccount.get(a.id) ?? 0)}
          />
        ))}
      </Card>
      <Link to="/settings/accounts" className="button secondary">
        {t('settings.money_accounts')}
      </Link>
    </Screen>
  );
}

export function ContactsReport({ kind }: { kind: 'receivable' | 'payable' }) {
  const { t } = useTranslation();
  const open = useOpenBalances();
  const contacts = useContacts();
  const money = useMoney();
  const pick = useLabel();
  const language = useLanguage();
  const rows = kind === 'receivable' ? open.receivable : open.payable;
  const total = kind === 'receivable' ? open.owedToMe : open.iOwe;
  const days = (date: string) =>
    Math.max(0, Math.round((Date.parse(today()) - Date.parse(date)) / 86_400_000));
  return (
    <Screen
      title={t(kind === 'receivable' ? 'reports.owed_to_me' : 'reports.i_owe')}
      subtitle={t(
        kind === 'receivable' ? 'reports.accounting.receivables' : 'reports.accounting.payables',
      )}
      back="/reports"
    >
      <Card className="stat">
        <div className="stat-label">{t('common.total')}</div>
        <div className={`stat-value ${kind === 'receivable' ? 'in' : 'out'}`}>{money(total)}</div>
        <div className="muted small">{t('reports.balances_note')}</div>
      </Card>
      {rows.length === 0 ? (
        <EmptyState
          title={t(kind === 'receivable' ? 'reports.nobody_owes' : 'reports.owe_nobody')}
        />
      ) : (
        <Card className="flush">
          {rows.map((r) => {
            const c = contacts.find((x) => x.id === r.contactId);
            return (
              <Row
                key={r.contactId}
                to={`/contacts/${r.contactId}`}
                title={c ? pick(c.name) : '?'}
                subtitle={
                  r.oldestOpenDate
                    ? `${t('reports.oldest')} ${formatDate(r.oldestOpenDate, language)} · ${t('contacts.days_ago', { count: days(r.oldestOpenDate) })}`
                    : undefined
                }
                right={money(r.balance)}
                rightSub={t('reports.open_count', { count: r.openDocuments })}
              />
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

export function ProfitReport() {
  const { t } = useTranslation();
  const { business } = useSession();
  const money = useMoney();
  const pick = useLabel();
  const language = useLanguage();
  const [period, setPeriod] = useState<'month' | 'last_month' | 'year'>('month');
  const range = useMemo(() => {
    const day = today();
    if (period === 'month') return monthRange(day);
    if (period === 'year') return fiscalYearRange(day, business.fiscalYearStartMonth);
    const first = monthRange(day).from;
    const prev = new Date(`${first}T00:00:00Z`);
    prev.setUTCDate(0);
    return monthRange(prev.toISOString().slice(0, 10));
  }, [period, business.fiscalYearStartMonth]);
  const pl = useProfitAndLoss(business.accountingMode, range.from, range.to);
  const lines = (rows: typeof pl.income) =>
    rows.map((l) => <Row key={l.accountId} title={pick(l.name)} right={money(l.amount)} />);
  return (
    <Screen
      title={t('reports.profit')}
      subtitle={t('reports.accounting.profit_and_loss')}
      back="/reports"
    >
      <ModeLine mode={business.accountingMode} />
      <Choice
        value={period}
        onChange={(v) => setPeriod(v)}
        options={[
          { value: 'month', label: t('reports.this_month') },
          { value: 'last_month', label: t('reports.last_month') },
          { value: 'year', label: t('reports.this_year') },
        ]}
      />
      <div className="muted small">
        {formatDate(range.from, language)} – {formatDate(range.to, language)}
      </div>
      <PendingNote />
      <Card className="stat">
        <div className="stat-label">{t('home.profit')}</div>
        <div className={`stat-value ${pl.totals.netProfit >= 0 ? 'in' : 'out'}`}>
          {money(pl.totals.netProfit)}
        </div>
      </Card>
      <Section title={`${t('groups.money_in')} · ${money(pl.totals.income)}`}>
        <Card className="flush">{lines(pl.income)}</Card>
      </Section>
      {pl.costOfSales.length > 0 ? (
        <Section title={`${t('reports.cost_of_goods')} · ${money(pl.totals.costOfSales)}`}>
          <Card className="flush">{lines(pl.costOfSales)}</Card>
          <div className="muted small pad">
            {t('reports.gross_profit')}: {money(pl.totals.grossProfit)}
          </div>
        </Section>
      ) : null}
      <Section title={`${t('groups.money_out')} · ${money(pl.totals.expenses)}`}>
        <Card className="flush">{lines(pl.expenses)}</Card>
      </Section>
    </Screen>
  );
}

export function StockReport() {
  const { t } = useTranslation();
  const stock = useStockSummary();
  const money = useMoney();
  const pick = useLabel();
  return (
    <Screen title={t('reports.stock')} subtitle={t('reports.accounting.inventory')} back="/reports">
      <PendingNote />
      <Card className="stat">
        <div className="stat-label">{t('reports.stock_value')}</div>
        <div className="stat-value">{money(stock.totalValue)}</div>
        {stock.low.length > 0 ? (
          <div className="muted small">{t('home.low_stock', { count: stock.low.length })}</div>
        ) : null}
      </Card>
      <Card className="flush">
        {[...stock.items]
          .sort((a, b) => b.stockValue - a.stockValue)
          .map((i) => (
            <Row
              key={i.id}
              to={`/items/${i.id}`}
              title={pick(i.name)}
              subtitle={`${formatQuantity(i.quantityOnHandMilli)} ${pick(i.unit)} × ${money(i.averageCost)}`}
              right={money(i.stockValue)}
              rightSub={
                i.quantityOnHandMilli < 0
                  ? t('items.negative')
                  : stock.low.includes(i)
                    ? t('items.low')
                    : undefined
              }
              tone={i.quantityOnHandMilli < 0 ? 'out' : 'neutral'}
            />
          ))}
      </Card>
    </Screen>
  );
}

const GROUP_ORDER: OwnerGroup[] = [
  'my_money',
  'owed_to_me',
  'stock',
  'things_i_own',
  'i_owe',
  'owner',
];

export function WorthReport() {
  const { t } = useTranslation();
  const { business } = useSession();
  const money = useMoney();
  const pick = useLabel();
  const sheet = useBalanceSheet(business.accountingMode, today());
  return (
    <Screen
      title={t('reports.worth')}
      subtitle={t('reports.accounting.balance_sheet')}
      back="/reports"
    >
      <ModeLine mode={business.accountingMode} />
      <PendingNote />
      <Card className="stat">
        <div className="stat-label">{t('reports.owner_share')}</div>
        <div className="stat-value">{money(sheet.totals.owner)}</div>
        <div className="muted small">
          {t('reports.own')} {money(sheet.totals.own)} − {t('reports.owe')}{' '}
          {money(sheet.totals.owe)}
        </div>
      </Card>
      {GROUP_ORDER.map((g) => {
        const group = sheet.groups.find((x) => x.group === g);
        if (!group || (group.lines.length === 0 && g !== 'owner')) return null;
        return (
          <Section
            key={g}
            title={`${t(`groups.${g}`)} · ${money(group.total + (g === 'owner' ? sheet.profitToDate : 0))}`}
          >
            <Card className="flush">
              {group.lines.map((l) => (
                <Row key={l.accountId} title={pick(l.name)} right={money(l.amount)} />
              ))}
              {g === 'owner' ? (
                <Row title={t('reports.profit_to_date')} right={money(sheet.profitToDate)} />
              ) : null}
            </Card>
          </Section>
        );
      })}
      {business.accountingMode === 'cash' ? (
        <p className="muted small">{t('reports.cash_sheet_note')}</p>
      ) : null}
    </Screen>
  );
}
