import { monthRange } from '@cannopy/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  useBalanceSheet,
  useDocuments,
  useMoneyAccounts,
  useMoneyBalances,
  useOpenBalances,
  useProfitAndLoss,
  useStockSummary,
} from '../data/hooks';
import { useSession } from '../data/session';
import { useSyncStatus } from '../sync/manager';
import { formatDate, today, useLabel, useLanguage, useMoney } from '../ui/format';
import { Row, Stat } from '../ui/List';
import { Card, Section } from '../ui/Screen';
import { documentTitle } from './documents';
import { SyncChip } from './SyncChip';

/**
 * Home answers the owner's four questions (how much money, who owes me, am I
 * making money, what stock) with the six plain groups from the scope doc and
 * puts the three everyday actions on big buttons. Money and balances come
 * from the documents on the device, so they are right offline and include
 * sales not yet synced; profit and owner's share come from the journal the
 * device has pulled.
 */
export function Home() {
  const { t } = useTranslation();
  const { business } = useSession();
  const language = useLanguage();
  const money = useMoney();
  const pick = useLabel();
  const status = useSyncStatus();
  const accounts = useMoneyAccounts();
  const balances = useMoneyBalances();
  const open = useOpenBalances();
  const stock = useStockSummary();
  const month = monthRange(today());
  const pl = useProfitAndLoss(business.accountingMode, month.from, month.to);
  const sheet = useBalanceSheet(business.accountingMode, today());
  const recent = useDocuments().slice(0, 5);

  return (
    <div className="screen home">
      <header className="screen-header">
        <div className="screen-title">
          <h1>{pick(business.name) || t('app.name')}</h1>
          <SyncChip />
        </div>
        <div className="screen-actions">
          <Link to="/settings" className="icon-button" aria-label={t('nav.settings')}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </header>

      <div className="screen-body">
        <section className="actions" aria-label={t('nav.main')}>
          <Link to="/sell" className="big-button">
            {t('actions.sell')}
          </Link>
          <Link to="/spend" className="big-button spend">
            {t('actions.spend')}
          </Link>
          <Link to="/get-paid" className="big-button paid">
            {t('actions.get_paid')}
          </Link>
        </section>
        <section className="actions-small">
          <Link to="/buy" className="chip link">
            {t('actions.buy')}
          </Link>
          <Link to="/pay" className="chip link">
            {t('actions.pay')}
          </Link>
          <Link to="/owner" className="chip link">
            {t('actions.owner')}
          </Link>
          <Link to="/transfer" className="chip link">
            {t('actions.transfer')}
          </Link>
        </section>

        <Link to="/reports/money" className="card stat hero">
          <div className="stat-label">{t('groups.my_money')}</div>
          <div className="stat-value">{money(balances.total)}</div>
          <div className="mini-rows">
            {accounts.map((a) => (
              <div key={a.id} className="mini-row">
                <span>{a.provider || pick(a.name)}</span>
                <span>{money(balances.byAccount.get(a.id) ?? 0)}</span>
              </div>
            ))}
          </div>
        </Link>

        <div className="grid2">
          <Stat
            label={t('groups.owed_to_me')}
            value={money(open.owedToMe)}
            sub={t('home.people', { count: open.receivable.length })}
            to="/reports/owed-to-me"
          />
          <Stat
            label={t('groups.i_owe')}
            value={money(open.iOwe)}
            sub={t('home.people', { count: open.payable.length })}
            to="/reports/i-owe"
          />
          <Stat
            label={t('groups.stock')}
            value={money(stock.totalValue)}
            sub={
              stock.low.length > 0
                ? t('home.low_stock', { count: stock.low.length })
                : t('home.items_count', { count: stock.items.length })
            }
            to="/reports/stock"
          />
          <Stat
            label={t('groups.owner')}
            value={money(sheet.totals.owner)}
            sub={t('home.profit_to_date', { amount: money(sheet.profitToDate) })}
            to="/reports/worth"
          />
        </div>

        <Link to="/reports/profit" className="card stat">
          <div className="stat-label">
            {t('home.this_month')} · {t(`mode.${business.accountingMode}`)}
          </div>
          <div className="inout">
            <div>
              <div className="muted small">{t('groups.money_in')}</div>
              <div className="stat-value in">{money(pl.totals.income)}</div>
            </div>
            <div>
              <div className="muted small">{t('groups.money_out')}</div>
              <div className="stat-value out">
                {money(pl.totals.costOfSales + pl.totals.expenses)}
              </div>
            </div>
          </div>
          <div className={`profit-line ${pl.totals.netProfit >= 0 ? 'in' : 'out'}`}>
            {t('home.profit')}: {money(pl.totals.netProfit)}
          </div>
          {status.pending > 0 ? (
            <div className="muted small">{t('home.profit_pending')}</div>
          ) : null}
        </Link>

        {recent.length > 0 ? (
          <Section
            title={t('home.recent')}
            aside={<Link to="/history">{t('common.see_all')}</Link>}
          >
            <Card className="flush">
              {recent.map((d) => (
                <Row
                  key={d.id}
                  to={`/documents/${d.id}`}
                  title={documentTitle(d, t)}
                  subtitle={formatDate(d.date, language)}
                  right={money(d.total)}
                  tone={
                    d.type === 'sale' || d.type === 'payment_in' || d.type === 'owner_in'
                      ? 'in'
                      : 'neutral'
                  }
                />
              ))}
            </Card>
          </Section>
        ) : (
          <Card>
            <p className="muted">{t('home.first_steps')}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
