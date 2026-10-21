import type { Document } from '@cannopy/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useAccounts, useDocument } from '../data/hooks';
import { newLine, repo } from '../data/repo';
import { useSession } from '../data/session';
import { AmountField, Button, DateField, TextField } from '../ui/fields';
import { today, useLabel, useMoney } from '../ui/format';
import { Picker, PickerButton } from '../ui/Picker';
import { Screen, Section } from '../ui/Screen';
import { ContactField, CREDIT, type PaidWith, PaidWithChips, useSaveDocument } from './shared';

/**
 * Spend (scope doc, journey 3): the amount, a plain-language category and the
 * money it came from. "Not paid yet" turns it into a bill owed to a supplier.
 */
export function Spend() {
  const { id } = useParams();
  const existing = useDocument(id);
  if (id && !existing) return null;
  return <SpendForm key={existing?.id ?? 'new'} existing={existing} />;
}

function SpendForm({ existing }: { existing?: Document | undefined }) {
  const { t } = useTranslation();
  const { business, user } = useSession();
  const money = useMoney();
  const pick = useLabel();
  const accounts = useAccounts();
  const { save, saving } = useSaveDocument();
  const categories = accounts.filter(
    (a) => (a.type === 'expense' || a.type === 'cost_of_sales') && !a.isHidden && a.code !== '5000',
  );

  const first = existing?.lines[0];
  const [amount, setAmount] = useState<number | null>(existing ? existing.total : null);
  const [accountId, setAccountId] = useState<string | null>(first?.accountId ?? null);
  const [paidWith, setPaidWith] = useState<PaidWith | null>(
    existing ? (existing.moneyAccountId ?? CREDIT) : null,
  );
  const [fee, setFee] = useState(existing?.feeAmount ?? 0);
  const [contactId, setContactId] = useState<string | null>(existing?.contactId ?? null);
  const [date, setDate] = useState(existing?.date ?? today());
  const [note, setNote] = useState(existing?.note ?? first?.description ?? '');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const category = categories.find((a) => a.id === accountId);

  const submit = async () => {
    if (!amount || amount <= 0) return setError(t('spend.need_amount'));
    if (!accountId) return setError(t('spend.need_category'));
    if (!paidWith) return setError(t('spend.need_paid_with'));
    if (paidWith === CREDIT && !contactId) return setError(t('spend.need_supplier'));
    setError(null);
    const doc: Document = {
      ...(existing ?? (await repo.newDocument(business.id, user.id, 'expense', date))),
      date,
      lines: [
        newLine({ ...(first ? { id: first.id } : {}), accountId, amount, description: note }),
      ],
      total: amount,
      moneyAccountId: paidWith === CREDIT ? null : paidWith,
      contactId,
      feeAmount: paidWith === CREDIT ? 0 : fee,
      note,
    };
    await save(doc, t('spend.saved', { amount: money(amount) }), existing ? -1 : '/');
  };

  return (
    <Screen
      title={existing ? t('spend.edit_title') : t('actions.spend')}
      back
      footer={
        <Button full onClick={() => void submit()} disabled={saving}>
          {t('common.save')}
        </Button>
      }
    >
      <Section>
        <AmountField
          label={t('form.amount')}
          value={amount}
          onChange={setAmount}
          big
          autoFocus={!existing}
        />
        <PickerButton
          label={t('spend.category')}
          value={category ? pick(category.name) : null}
          placeholder={t('spend.pick_category')}
          onClick={() => setPicking(true)}
        />
        <PaidWithChips
          label={t('form.paid_from')}
          value={paidWith}
          onChange={(v) => setPaidWith(v)}
          creditLabel={t('form.not_paid_yet')}
          fee={fee}
          onFee={setFee}
        />
        <ContactField
          kind="supplier"
          value={contactId}
          onChange={setContactId}
          required={paidWith === CREDIT}
          label={paidWith === CREDIT ? t('form.supplier') : t('form.supplier_optional')}
        />
        <DateField value={date} onChange={setDate} />
        <TextField
          label={t('form.note')}
          value={note}
          onChange={setNote}
          placeholder={t('spend.note_hint')}
        />
        {error ? <div className="banner warn">{error}</div> : null}
      </Section>
      <Picker
        open={picking}
        title={t('spend.category')}
        options={categories.map((a) => ({ key: a.id, value: a.id, title: pick(a.name) }))}
        onPick={(id) => {
          setAccountId(id);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </Screen>
  );
}
