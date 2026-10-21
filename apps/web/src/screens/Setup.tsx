import {
  type Account,
  type Business,
  SYSTEM_ACCOUNT_CODES as C,
  dayBefore,
  labelFromInput,
  type MemberRole,
  newId,
} from '@cannopy/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api, isAuthError, isNetworkError } from '../data/api';
import { newLine, repo } from '../data/repo';
import { useSessionState } from '../data/session';
import { localDb } from '../db/local';
import { AmountField, Button, Choice, TextField } from '../ui/fields';
import { today, useLanguage } from '../ui/format';

/**
 * Five-minute setup (scope doc, journey 1), cut to the questions a first sale
 * needs: business name and type, fiscal year, opening money. Language and the
 * owner's name and phone were taken at sign-in. Opening stock and customers
 * who already owe are added from their own screens, where the owner can see
 * what they are doing. Currency is MMK and is not asked.
 *
 * Creating the business is the one step that needs the server, because the
 * API assigns the chart of accounts and makes the signed-in user its owner.
 * Everything after it works offline.
 */
type Step = 'business' | 'year' | 'money';

const BUSINESS_TYPES: Business['type'][] = [
  'shop',
  'food_and_drink',
  'trader',
  'service',
  'online_seller',
  'other',
];

export function Setup() {
  const { t } = useTranslation();
  const language = useLanguage();
  const navigate = useNavigate();
  const { auth, session, openBusiness } = useSessionState();
  const [step, setStep] = useState<Step>('business');
  const [name, setName] = useState('');
  const [type, setType] = useState<Business['type']>('shop');
  const [fiscalMonth, setFiscalMonth] = useState(4);
  const [cash, setCash] = useState<number | null>(null);
  const [bank, setBank] = useState<number | null>(null);
  const [wallet, setWallet] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const steps: Step[] = ['business', 'year', 'money'];
  const index = steps.indexOf(step);

  const finish = async () => {
    if (!auth) return navigate('/sign-in', { replace: true });
    setBusy(true);
    setError(null);
    const now = new Date().toISOString();
    const business: Business = {
      id: newId(),
      name: labelFromInput(name.trim(), language),
      type,
      primaryLanguage: language,
      accountingMode: 'cash',
      fiscalYearStartMonth: fiscalMonth,
      currency: 'MMK',
      taxEnabled: false,
      lockDate: null,
      digitGrouping: 'thousand',
      myanmarDigits: false,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const created = await api<{ business: Business; role: MemberRole; accounts: Account[] }>(
        '/businesses',
        { body: { business } },
      );
      await openBusiness(created.business, created.role);
      await localDb.accounts.bulkPut(created.accounts);

      const byCode = new Map(created.accounts.map((a) => [a.code, a.id]));
      const opening = [
        [C.CASH, cash],
        ['1010', bank],
        ['1020', wallet],
      ].filter((x): x is [string, number] => typeof x[1] === 'number' && x[1] > 0);
      if (opening.length > 0) {
        const doc = await repo.newDocument(
          business.id,
          auth.user.id,
          'opening_balance',
          dayBefore(today()),
        );
        doc.lines = opening.map(([code, amount]) =>
          newLine({ accountId: byCode.get(code) ?? null, amount }),
        );
        doc.total = opening.reduce((s, [, amount]) => s + amount, 0);
        doc.note = t('setup.opening_note');
        await repo.saveDocument(doc);
      }
      navigate('/', { replace: true });
    } catch (err) {
      if (isAuthError(err)) return navigate('/sign-in?again=1', { replace: true });
      setError(isNetworkError(err) ? t('setup.need_internet') : t('setup.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen setup">
      <div className="screen-body">
        {index >= 0 ? (
          <div className="progress" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s} className={i <= index ? 'on' : ''} />
            ))}
          </div>
        ) : null}

        {step === 'business' ? (
          <div className="setup-step">
            <h1>{t('setup.business_title')}</h1>
            <TextField
              label={t('setup.business_name')}
              value={name}
              onChange={setName}
              placeholder={t('setup.business_name_hint')}
              autoFocus
            />
            <Choice
              label={t('setup.business_type')}
              value={type}
              onChange={(v) => setType(v)}
              wrap
              options={BUSINESS_TYPES.map((v) => ({ value: v, label: t(`business_type.${v}`) }))}
            />
            <p className="muted small">{t('setup.owner_is', { name: auth?.user.name ?? '' })}</p>
          </div>
        ) : null}

        {step === 'year' ? (
          <div className="setup-step">
            <h1>{t('setup.year_title')}</h1>
            <p className="muted">{t('setup.year_hint')}</p>
            <Choice
              value={fiscalMonth === 4 ? 'april' : fiscalMonth === 1 ? 'january' : 'other'}
              onChange={(v) => setFiscalMonth(v === 'april' ? 4 : v === 'january' ? 1 : 10)}
              options={[
                { value: 'april', label: t('setup.year_april'), hint: t('setup.year_april_hint') },
                { value: 'january', label: t('setup.year_january') },
                { value: 'other', label: t('setup.year_other') },
              ]}
            />
            {fiscalMonth !== 4 && fiscalMonth !== 1 ? (
              <div className="field">
                <span className="field-label">{t('setup.year_month')}</span>
                <select
                  className="input"
                  value={fiscalMonth}
                  onChange={(e) => setFiscalMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {t(`month.${m}`)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <p className="muted small">{t('setup.currency_note')}</p>
          </div>
        ) : null}

        {step === 'money' ? (
          <div className="setup-step">
            <h1>{t('setup.money_title')}</h1>
            <p className="muted">{t('setup.money_hint')}</p>
            <AmountField
              label={t('setup.cash_in_hand')}
              value={cash}
              onChange={setCash}
              presets={false}
            />
            <AmountField label={t('setup.bank')} value={bank} onChange={setBank} presets={false} />
            <AmountField
              label={t('setup.wallet')}
              value={wallet}
              onChange={setWallet}
              presets={false}
            />
            <p className="muted small">{t('setup.money_later')}</p>
            {error ? <div className="banner warn">{error}</div> : null}
          </div>
        ) : null}
      </div>

      <div className="screen-footer two">
        <Button
          kind="secondary"
          onClick={() =>
            index === 0
              ? navigate(session ? '/' : '/choose', { replace: true })
              : setStep(steps[index - 1] ?? 'business')
          }
        >
          {index === 0 ? t('common.cancel') : t('common.back')}
        </Button>
        {step === 'money' ? (
          <Button onClick={() => void finish()} disabled={busy}>
            {busy ? t('setup.creating') : t('setup.start')}
          </Button>
        ) : (
          <Button
            onClick={() => setStep(steps[index + 1] ?? 'money')}
            disabled={step === 'business' && name.trim() === ''}
          >
            {t('common.next')}
          </Button>
        )}
      </div>
    </div>
  );
}
