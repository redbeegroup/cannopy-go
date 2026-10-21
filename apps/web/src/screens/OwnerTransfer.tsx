import type { Document } from '@cannopy/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useDocument, useMoneyAccounts } from '../data/hooks';
import { repo } from '../data/repo';
import { useSession } from '../data/session';
import { AmountField, Button, Choice, DateField, TextField } from '../ui/fields';
import { today, useLabel, useMoney } from '../ui/format';
import { Screen, Section } from '../ui/Screen';
import { type PaidWith, PaidWithChips, useSaveDocument } from './shared';

/** Owner money (journey 7): put money in or take money out. */
export function Owner() {
  const { id } = useParams();
  const existing = useDocument(id);
  if (id && !existing) return null;
  return <OwnerForm key={existing?.id ?? 'new'} existing={existing} />;
}

function OwnerForm({ existing }: { existing?: Document | undefined }) {
  const { t } = useTranslation();
  const { business, user } = useSession();
  const money = useMoney();
  const { save, saving } = useSaveDocument();
  const [direction, setDirection] = useState<'owner_in' | 'owner_out'>(
    existing?.type === 'owner_out' ? 'owner_out' : 'owner_in',
  );
  const [amount, setAmount] = useState<number | null>(existing?.total ?? null);
  const [account, setAccount] = useState<PaidWith | null>(existing?.moneyAccountId ?? null);
  const [date, setDate] = useState(existing?.date ?? today());
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!amount || amount <= 0) return setError(t('spend.need_amount'));
    if (!account) return setError(t('payment.need_account'));
    setError(null);
    const doc: Document = {
      ...(existing ?? (await repo.newDocument(business.id, user.id, direction, date))),
      type: direction,
      date,
      total: amount,
      moneyAccountId: account,
      feeAmount: 0,
      lines: [],
      note,
    };
    await save(doc, t('owner.saved', { amount: money(amount) }), existing ? -1 : '/');
  };

  return (
    <Screen
      title={t('actions.owner')}
      back
      footer={
        <Button full onClick={() => void submit()} disabled={saving}>
          {t('common.save')}
        </Button>
      }
    >
      <Section>
        <Choice
          value={direction}
          onChange={(v) => setDirection(v)}
          options={[
            { value: 'owner_in', label: t('owner.put_in'), hint: t('owner.put_in_hint') },
            { value: 'owner_out', label: t('owner.take_out'), hint: t('owner.take_out_hint') },
          ]}
        />
        <AmountField label={t('form.amount')} value={amount} onChange={setAmount} big />
        <PaidWithChips
          label={direction === 'owner_in' ? t('form.paid_into') : t('form.paid_from')}
          value={account}
          onChange={(v) => setAccount(v)}
          creditLabel=""
          allowCredit={false}
          fee={0}
          onFee={() => {}}
        />
        <DateField value={date} onChange={setDate} />
        <TextField label={t('form.note')} value={note} onChange={setNote} />
        {error ? <div className="banner warn">{error}</div> : null}
      </Section>
    </Screen>
  );
}

/** Move money (journey 8): between two money accounts, with the cash-out fee as an expense. */
export function Transfer() {
  const { id } = useParams();
  const existing = useDocument(id);
  if (id && !existing) return null;
  return <TransferForm key={existing?.id ?? 'new'} existing={existing} />;
}

function TransferForm({ existing }: { existing?: Document | undefined }) {
  const { t } = useTranslation();
  const { business, user } = useSession();
  const money = useMoney();
  const pick = useLabel();
  const accounts = useMoneyAccounts();
  const { save, saving } = useSaveDocument();
  const [from, setFrom] = useState<string | null>(existing?.moneyAccountId ?? null);
  const [to, setTo] = useState<string | null>(existing?.toMoneyAccountId ?? null);
  const [amount, setAmount] = useState<number | null>(existing?.total ?? null);
  const [fee, setFee] = useState(existing?.feeAmount ?? 0);
  const [date, setDate] = useState(existing?.date ?? today());
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const options = accounts.map((a) => ({ value: a.id, label: a.provider || pick(a.name) }));

  const submit = async () => {
    if (!amount || amount <= 0) return setError(t('spend.need_amount'));
    if (!from || !to) return setError(t('transfer.need_accounts'));
    if (from === to) return setError(t('transfer.same_account'));
    if (fee > amount) return setError(t('form.fee_too_big'));
    setError(null);
    const doc: Document = {
      ...(existing ?? (await repo.newDocument(business.id, user.id, 'transfer', date))),
      date,
      total: amount,
      moneyAccountId: from,
      toMoneyAccountId: to,
      feeAmount: fee,
      lines: [],
      note,
    };
    await save(doc, t('transfer.saved', { amount: money(amount) }), existing ? -1 : '/');
  };

  return (
    <Screen
      title={t('actions.transfer')}
      back
      footer={
        <Button full onClick={() => void submit()} disabled={saving}>
          {t('common.save')}
        </Button>
      }
    >
      <Section>
        <Choice label={t('transfer.from')} value={from} onChange={setFrom} options={options} wrap />
        <Choice label={t('transfer.to')} value={to} onChange={setTo} options={options} wrap />
        <AmountField label={t('form.amount')} value={amount} onChange={setAmount} big />
        <AmountField
          label={t('transfer.fee')}
          hint={t('transfer.fee_hint')}
          value={fee || null}
          onChange={(v) => setFee(v ?? 0)}
          presets={false}
        />
        {amount && to ? (
          <div className="banner info">
            {t('transfer.arrives', {
              amount: money(Math.max(0, amount - fee)),
              account: options.find((o) => o.value === to)?.label ?? '',
            })}
          </div>
        ) : null}
        <DateField value={date} onChange={setDate} />
        <TextField label={t('form.note')} value={note} onChange={setNote} />
        {error ? <div className="banner warn">{error}</div> : null}
      </Section>
    </Screen>
  );
}
