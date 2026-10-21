import { allocateOldestFirst, type Document, type OpenBalance, openBalances } from '@cannopy/core';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { useAccounts, useContacts, useDocument, useDocuments } from '../data/hooks';
import { repo } from '../data/repo';
import { useSession } from '../data/session';
import { AmountField, Button, DateField, TextField, Toggle } from '../ui/fields';
import { formatDate, today, useLabel, useLanguage, useMoney } from '../ui/format';
import { Row } from '../ui/List';
import { Card, Screen, Section } from '../ui/Screen';
import { documentTitle } from './documents';
import { ContactField, type PaidWith, PaidWithChips, useSaveDocument } from './shared';

/**
 * Get paid (journey 5) and Pay a supplier (journey 6). Pick the person, see
 * what is open, type any amount; the split is oldest first unless the owner
 * changes it. Anything beyond what is owed is kept as an advance.
 */
export function Payment({ kind }: { kind: 'receivable' | 'payable' }) {
  const { id } = useParams();
  const existing = useDocument(id);
  if (id && !existing) return null;
  return <PaymentForm key={existing?.id ?? 'new'} kind={kind} existing={existing} />;
}

function PaymentForm({
  kind,
  existing,
}: {
  kind: 'receivable' | 'payable';
  existing?: Document | undefined;
}) {
  const { t } = useTranslation();
  const { business, user } = useSession();
  const [params] = useSearchParams();
  const money = useMoney();
  const pick = useLabel();
  const language = useLanguage();
  const accounts = useAccounts();
  const contacts = useContacts();
  const docs = useDocuments();
  const { save, saving } = useSaveDocument();
  const type = kind === 'receivable' ? 'payment_in' : 'payment_out';

  const [contactId, setContactId] = useState<string | null>(
    existing?.contactId ?? params.get('contact') ?? null,
  );
  const [amount, setAmount] = useState<number | null>(existing?.total ?? null);
  const [paidWith, setPaidWith] = useState<PaidWith | null>(existing?.moneyAccountId ?? null);
  const [fee, setFee] = useState(existing?.feeAmount ?? 0);
  const [date, setDate] = useState(existing?.date ?? today());
  const [note, setNote] = useState(existing?.note ?? '');
  const [custom, setCustom] = useState(false);
  const [split, setSplit] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  // Open documents of this contact, not counting the payment being edited.
  const open: OpenBalance[] = useMemo(() => {
    const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
    return openBalances(
      docs.filter((d) => d.id !== existing?.id),
      (id) => codeOf.get(id),
    ).filter((o) => o.contactId === contactId && o.kind === kind && o.balance > 0);
  }, [docs, accounts, contactId, kind, existing?.id]);
  const owed = open.reduce((s, o) => s + o.balance, 0);

  const auto = useMemo(
    () =>
      allocateOldestFirst(
        amount ?? 0,
        open.map((o) => ({
          documentId: o.documentId,
          date: o.date,
          total: o.total,
          paidAmount: o.paid,
        })),
      ),
    [amount, open],
  );

  useEffect(() => {
    if (existing && Object.keys(split).length === 0) {
      const s: Record<string, number> = {};
      for (const a of existing.allocations) s[a.documentId] = a.amount;
      if (existing.allocations.length > 0) {
        setSplit(s);
        setCustom(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  const allocations = custom
    ? open
        .map((o) => ({ documentId: o.documentId, amount: split[o.documentId] ?? 0 }))
        .filter((a) => a.amount > 0)
    : auto.allocations;
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  const advance = (amount ?? 0) - allocated;

  const submit = async () => {
    if (!contactId)
      return setError(t(kind === 'receivable' ? 'sell.need_customer' : 'spend.need_supplier'));
    if (!amount || amount <= 0) return setError(t('spend.need_amount'));
    if (!paidWith) return setError(t('payment.need_account'));
    if (allocated > amount) return setError(t('payment.split_too_big'));
    for (const a of allocations) {
      const o = open.find((x) => x.documentId === a.documentId);
      if (o && a.amount > o.balance)
        return setError(t('payment.split_over', { title: documentOf(o) }));
    }
    if (kind === 'receivable' && fee > amount) return setError(t('form.fee_too_big'));
    setError(null);
    const doc: Document = {
      ...(existing ?? (await repo.newDocument(business.id, user.id, type, date))),
      date,
      contactId,
      moneyAccountId: paidWith,
      total: amount,
      feeAmount: fee,
      allocations,
      lines: [],
      note,
    };
    await save(
      doc,
      t(kind === 'receivable' ? 'payment.saved_in' : 'payment.saved_out', {
        amount: money(amount),
      }),
      existing ? -1 : '/',
    );
  };

  const documentOf = (o: OpenBalance) => {
    const d = docs.find((x) => x.id === o.documentId);
    return d ? documentTitle(d, t) : t('doc.opening_balance');
  };
  const contact = contacts.find((c) => c.id === contactId);

  return (
    <Screen
      title={
        existing
          ? t('payment.edit_title')
          : t(kind === 'receivable' ? 'actions.get_paid' : 'actions.pay')
      }
      back
      footer={
        <Button full onClick={() => void submit()} disabled={saving}>
          {t('common.save')}
        </Button>
      }
    >
      <Section>
        <ContactField
          kind={kind === 'receivable' ? 'customer' : 'supplier'}
          value={contactId}
          onChange={(id) => {
            setContactId(id);
            setCustom(false);
            setSplit({});
          }}
          required
        />
        {contact ? (
          <Card className="owed-card">
            <div className="muted small">
              {t(kind === 'receivable' ? 'payment.they_owe' : 'payment.you_owe', {
                name: pick(contact.name),
              })}
            </div>
            <div className="stat-value">{money(owed)}</div>
            {owed > 0 ? (
              <Button small kind="secondary" onClick={() => setAmount(owed)}>
                {t('payment.pay_all')}
              </Button>
            ) : null}
          </Card>
        ) : null}
        <AmountField
          label={t(kind === 'receivable' ? 'payment.amount_received' : 'payment.amount_paid')}
          value={amount}
          onChange={setAmount}
          big
        />
        <PaidWithChips
          label={t(kind === 'receivable' ? 'form.paid_into' : 'form.paid_from')}
          value={paidWith}
          onChange={(v) => setPaidWith(v)}
          creditLabel=""
          allowCredit={false}
          fee={fee}
          onFee={setFee}
        />
      </Section>

      {open.length > 0 ? (
        <Section
          title={t('payment.split_title')}
          aside={<Toggle label={t('payment.change_split')} checked={custom} onChange={setCustom} />}
        >
          <Card className="flush">
            {open.map((o) => {
              const current = custom
                ? (split[o.documentId] ?? 0)
                : (auto.allocations.find((a) => a.documentId === o.documentId)?.amount ?? 0);
              return (
                <div key={o.documentId} className="split-row">
                  <Row
                    title={documentOf(o)}
                    subtitle={`${formatDate(o.date, language)} · ${t('payment.still_owed')} ${money(o.balance)}`}
                    right={custom ? undefined : money(current)}
                  />
                  {custom ? (
                    <AmountField
                      value={current || null}
                      onChange={(v) =>
                        setSplit((s) => ({ ...s, [o.documentId]: Math.min(v ?? 0, o.balance) }))
                      }
                      presets={false}
                    />
                  ) : null}
                </div>
              );
            })}
          </Card>
          {advance > 0 ? (
            <div className="banner info">{t('payment.advance', { amount: money(advance) })}</div>
          ) : null}
        </Section>
      ) : contactId && amount ? (
        <div className="banner info">{t('payment.no_open', { amount: money(amount) })}</div>
      ) : null}

      <Section>
        <DateField value={date} onChange={setDate} />
        <TextField label={t('form.note')} value={note} onChange={setNote} />
        {error ? <div className="banner warn">{error}</div> : null}
      </Section>
    </Screen>
  );
}
