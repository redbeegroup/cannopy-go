import {
  type Account,
  type AccountingMode,
  type Business,
  formatPhone,
  labelFromInput,
  nextAccountCode,
} from '@cannopy/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { api, isNetworkError } from '../data/api';
import { useAccounts } from '../data/hooks';
import { repo } from '../data/repo';
import { useSession, useSessionState } from '../data/session';
import { getMeta, localDb } from '../db/local';
import { REJECTED_KEY, type RejectedMutation } from '../sync/client';
import { syncManager, useSyncStatus } from '../sync/manager';
import { AmountField, Button, Choice, TextField, Toggle } from '../ui/fields';
import { formatTime, useLabel, useLanguage, useMoney } from '../ui/format';
import { Row } from '../ui/List';
import { Confirm } from '../ui/Picker';
import { Card, Screen, Section } from '../ui/Screen';
import { useToast } from '../ui/Toast';

export function Settings() {
  const { t, i18n } = useTranslation();
  const { business, user, role } = useSession();
  const { signOut, closeBusiness } = useSessionState();
  const navigate = useNavigate();
  const pick = useLabel();
  const status = useSyncStatus();
  const language = useLanguage();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  return (
    <Screen title={t('nav.settings')} back="/">
      <Section title={t('settings.language')}>
        <Choice
          value={language}
          onChange={(l) => void i18n.changeLanguage(l)}
          options={[
            { value: 'my', label: 'မြန်မာ' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Section>
      <Section title={t('settings.books')}>
        <Card className="flush">
          <Row
            to="/settings/mode"
            title={t('settings.mode')}
            right={t(`mode.${business.accountingMode}`)}
          />
          <Row to="/settings/accounts" title={t('settings.money_accounts')} />
          <Row to="/settings/display" title={t('settings.display')} />
          <Row to="/settings/people" title={t('people.title')} />
          <Row
            to="/settings/sync"
            title={t('settings.sync')}
            right={
              status.needsSignIn
                ? t('sync.sign_in_again')
                : status.pending > 0
                  ? t('sync.pending', { count: status.pending })
                  : t('sync.saved')
            }
          />
        </Card>
      </Section>
      <Section title={t('settings.business')}>
        <Card className="flush">
          <Row title={t('setup.business_name')} right={pick(business.name)} />
          <Row title={t('setup.business_type')} right={t(`business_type.${business.type}`)} />
          <Row
            title={t('settings.fiscal_year')}
            right={t(`month.${business.fiscalYearStartMonth}`)}
          />
        </Card>
        <p className="muted small">{t('settings.business_note')}</p>
      </Section>
      <Section title={t('settings.account')}>
        <Card className="flush">
          <Row
            title={user.name || formatPhone(user.phone)}
            subtitle={`${formatPhone(user.phone)} · ${t(`role.${role}`)}`}
          />
          <Row onClick={() => setConfirmSwitch(true)} title={t('settings.switch_business')} />
        </Card>
        <p className="muted small">{t('settings.account_hint')}</p>
      </Section>
      <Section title={t('settings.device')}>
        <Button kind="danger" onClick={() => setConfirmSignOut(true)}>
          {t('settings.sign_out')}
        </Button>
        <p className="muted small">{t('settings.sign_out_hint')}</p>
        <Confirm
          open={confirmSignOut}
          title={t('settings.sign_out')}
          text={
            status.pending > 0
              ? t('settings.reset_pending', { count: status.pending })
              : t('settings.sign_out_confirm')
          }
          confirmLabel={t('settings.sign_out')}
          danger
          onConfirm={() => {
            void signOut().then(() => navigate('/sign-in', { replace: true }));
          }}
          onClose={() => setConfirmSignOut(false)}
        />
        <Confirm
          open={confirmSwitch}
          title={t('settings.switch_business')}
          text={
            status.pending > 0
              ? t('settings.reset_pending', { count: status.pending })
              : t('settings.switch_confirm')
          }
          confirmLabel={t('settings.switch_business')}
          onConfirm={() => {
            void closeBusiness().then(() => navigate('/choose', { replace: true }));
          }}
          onClose={() => setConfirmSwitch(false)}
        />
      </Section>
      <p className="muted small center">Cannopy GO · {t('app.tagline')}</p>
    </Screen>
  );
}

/** The cash/accrual switch: one business setting on the server, explained in plain words. */
export function ModeSettings() {
  const { t } = useTranslation();
  const { business, role } = useSession();
  const { updateBusiness } = useSessionState();
  const toast = useToast();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);

  const change = async (mode: AccountingMode) => {
    if (mode === business.accountingMode) return;
    setBusy(true);
    try {
      const updated = await api<Business>(`/businesses/${business.id}/accounting-mode`, {
        method: 'PUT',
        body: { mode },
      });
      await updateBusiness({ accountingMode: updated.accountingMode });
      toast(t('settings.mode_changed', { mode: t(`mode.${mode}`) }));
    } catch (err) {
      toast(
        isNetworkError(err) ? t('settings.mode_needs_internet') : t('common.save_failed'),
        'warn',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('settings.mode')} back="/settings">
      <Card>
        <p>{t('settings.mode_intro')}</p>
      </Card>
      <Choice
        value={business.accountingMode}
        onChange={(m) => void change(m)}
        options={[
          { value: 'cash', label: t('mode.cash'), hint: t('settings.mode_cash_hint') },
          { value: 'accrual', label: t('mode.accrual'), hint: t('settings.mode_accrual_hint') },
        ]}
      />
      {busy ? <div className="muted small">{t('common.saving')}</div> : null}
      {!status.online ? (
        <div className="banner warn">{t('settings.mode_needs_internet')}</div>
      ) : null}
      {role !== 'owner' ? <div className="banner info">{t('settings.mode_owner_only')}</div> : null}
      <p className="muted small">{t('settings.mode_note')}</p>
    </Screen>
  );
}

/** Money accounts: the cash drawer, banks and wallets the owner pays with. */
export function MoneyAccounts() {
  const { t } = useTranslation();
  const accounts = useAccounts().filter((a) => a.moneyKind);
  const pick = useLabel();
  const money = useMoney();
  return (
    <Screen
      title={t('settings.money_accounts')}
      back="/settings"
      actions={
        <Link to="/settings/accounts/new" className="button primary small">
          + {t('common.add')}
        </Link>
      }
    >
      <Card className="flush">
        {accounts.map((a) => (
          <Row
            key={a.id}
            to={`/settings/accounts/${a.id}`}
            title={a.provider || pick(a.name)}
            subtitle={`${t(`money_kind.${a.moneyKind}`)}${a.defaultFee ? ` · ${t('form.fee')} ${money(a.defaultFee)}` : ''}${a.isHidden ? ` · ${t('settings.hidden')}` : ''}`}
          />
        ))}
      </Card>
      <p className="muted small">{t('settings.accounts_hint')}</p>
    </Screen>
  );
}

export function MoneyAccountEdit() {
  const { id } = useParams();
  const accounts = useAccounts();
  const existing = id === 'new' ? undefined : accounts.find((a) => a.id === id);
  if (id !== 'new' && !existing) return null;
  return <MoneyAccountForm key={existing?.id ?? 'new'} existing={existing} />;
}

function MoneyAccountForm({ existing }: { existing?: Account | undefined }) {
  const { t } = useTranslation();
  const { business } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const language = useLanguage();
  const pick = useLabel();
  const accounts = useAccounts();
  const [name, setName] = useState(existing ? pick(existing.name) : '');
  const [kind, setKind] = useState<'cash' | 'bank' | 'wallet'>(existing?.moneyKind ?? 'wallet');
  const [provider, setProvider] = useState(existing?.provider ?? '');
  const [fee, setFee] = useState<number | null>(existing?.defaultFee ?? null);
  const [hidden, setHidden] = useState(existing?.isHidden ?? false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() && !provider.trim()) return setError(t('settings.account_need_name'));
    setError(null);
    const account: Account = existing
      ? {
          ...existing,
          name: { ...existing.name, [language]: name.trim() || existing.name[language] },
          provider: provider.trim() || null,
          defaultFee: fee,
          isHidden: hidden,
        }
      : {
          ...repo.newRow(business.id),
          code: nextAccountCode(
            'my_money',
            accounts.map((a) => a.code),
          ),
          type: 'asset',
          ownerGroup: 'my_money',
          name: labelFromInput(name.trim() || provider.trim(), language),
          isSystem: false,
          isHidden: hidden,
          moneyKind: kind,
          provider: provider.trim() || null,
          defaultFee: fee,
        };
    await repo.saveAccount(account);
    toast(t('settings.account_saved'));
    navigate('/settings/accounts', { replace: true });
  };

  return (
    <Screen
      title={existing ? pick(existing.name) : t('settings.new_account')}
      back="/settings/accounts"
      footer={
        <Button full onClick={() => void submit()}>
          {t('common.save')}
        </Button>
      }
    >
      <Section>
        {!existing ? (
          <Choice
            label={t('settings.account_kind')}
            value={kind}
            onChange={(v) => setKind(v)}
            options={[
              { value: 'wallet', label: t('money_kind.wallet') },
              { value: 'bank', label: t('money_kind.bank') },
              { value: 'cash', label: t('money_kind.cash') },
            ]}
          />
        ) : null}
        {kind !== 'cash' ? (
          <Choice
            label={t('settings.provider')}
            value={provider}
            onChange={setProvider}
            wrap
            options={(kind === 'wallet'
              ? ['KBZPay', 'WavePay', 'AYA Pay', 'CB Pay', 'Mytel Pay']
              : ['KBZ', 'AYA', 'CB', 'Yoma', 'UAB']
            ).map((p) => ({ value: p, label: p }))}
          />
        ) : null}
        <TextField
          label={t('settings.account_name')}
          value={name}
          onChange={setName}
          placeholder={provider || t('settings.account_name_hint')}
        />
        {kind === 'wallet' ? (
          <AmountField
            label={t('settings.default_fee')}
            hint={t('settings.default_fee_hint')}
            value={fee}
            onChange={setFee}
            presets={false}
          />
        ) : null}
        {existing && !existing.isSystem ? (
          <Toggle
            label={t('settings.hide_account')}
            hint={t('settings.hide_account_hint')}
            checked={hidden}
            onChange={setHidden}
          />
        ) : null}
        {error ? <div className="banner warn">{error}</div> : null}
      </Section>
    </Screen>
  );
}

/** Display preferences kept on this device (the API has no business settings route yet). */
export function DisplaySettings() {
  const { t } = useTranslation();
  const { business } = useSession();
  const { updateBusiness } = useSessionState();
  return (
    <Screen title={t('settings.display')} back="/settings">
      <Section>
        <Choice
          label={t('settings.grouping')}
          value={business.digitGrouping}
          onChange={(v) => void updateBusiness({ digitGrouping: v })}
          options={[
            { value: 'thousand', label: '1,250,000' },
            { value: 'lakh', label: '12,50,000', hint: t('settings.lakh_hint') },
          ]}
        />
        <Toggle
          label={t('settings.myanmar_digits')}
          checked={business.myanmarDigits}
          onChange={(v) => void updateBusiness({ myanmarDigits: v })}
          hint="၁,၂၅၀,၀၀၀"
        />
        <Toggle
          label={t('settings.tax_enabled')}
          hint={t('settings.tax_hint')}
          checked={business.taxEnabled}
          onChange={(v) => void updateBusiness({ taxEnabled: v })}
        />
        <p className="muted small">{t('settings.display_note')}</p>
      </Section>
    </Screen>
  );
}

export function SyncSettings() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const language = useLanguage();
  const rejected = useLiveQuery(() => getMeta<RejectedMutation[]>(localDb, REJECTED_KEY), []) ?? [];
  return (
    <Screen title={t('settings.sync')} back="/settings">
      <Card className="flush">
        <Row
          title={t('sync.connection')}
          right={status.online ? t('sync.online') : t('sync.offline')}
        />
        <Row title={t('sync.waiting')} right={String(status.pending)} />
        <Row
          title={t('sync.last')}
          right={status.lastSyncAt ? formatTime(status.lastSyncAt, language) : '—'}
        />
        {status.needsSignIn ? (
          <Row
            to="/sign-in?again=1"
            title={t('sync.sign_in_again')}
            subtitle={t('sync.sign_in_again_hint')}
          />
        ) : status.lastError ? (
          <Row title={t('sync.error')} subtitle={status.lastError} />
        ) : null}
      </Card>
      <Button
        kind="secondary"
        onClick={() => void syncManager.syncNow()}
        disabled={status.phase === 'syncing' || !status.online}
      >
        {status.phase === 'syncing' ? t('sync.syncing') : t('sync.sync_now')}
      </Button>
      <p className="muted small">{t('sync.explain')}</p>
      {rejected.length > 0 ? (
        <Section title={t('sync.rejected_title')}>
          <p className="muted small">{t('sync.rejected_hint')}</p>
          <Card className="flush">
            {rejected.map((r) => (
              <Row
                key={r.id}
                title={t(`entity.${r.entity}`)}
                subtitle={`${formatTime(r.at, language)} · ${r.reason}`}
                to={r.entity === 'document' ? `/documents/${r.entityId}` : undefined}
              />
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
