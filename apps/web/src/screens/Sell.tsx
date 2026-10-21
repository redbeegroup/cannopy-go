import {
  type Document,
  type DocumentLine,
  divRound,
  type Item,
  labelFromInput,
} from '@cannopy/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useDocument, useItems } from '../data/hooks';
import { newLine, repo } from '../data/repo';
import { useSession } from '../data/session';
import { AmountField, Button, DateField, QuantityField, TextField, Toggle } from '../ui/fields';
import { today, useLabel, useLanguage, useMoney } from '../ui/format';
import { Card, Screen, Section } from '../ui/Screen';
import {
  ContactField,
  CREDIT,
  ItemPicker,
  type PaidWith,
  PaidWithChips,
  sumLines,
  useSaveDocument,
} from './shared';

/**
 * Sell (scope doc, journey 2): pick items or type an amount, say how it was
 * paid, and for credit pick the customer. One method per sale; a part payment
 * at the till is a credit sale followed by Get paid (accounting core decision 6).
 */
export function Sell() {
  const { id } = useParams();
  const existing = useDocument(id);
  if (id && !existing) return null;
  return <SellForm key={existing?.id ?? 'new'} existing={existing} />;
}

const TAX_RATE = 5;

function SellForm({ existing }: { existing?: Document | undefined }) {
  const { t } = useTranslation();
  const { business, user } = useSession();
  const money = useMoney();
  const pick = useLabel();
  const language = useLanguage();
  const items = useItems();
  const { save, saving } = useSaveDocument();

  const [date, setDate] = useState(existing?.date ?? today());
  const [lines, setLines] = useState<DocumentLine[]>(existing?.lines ?? []);
  const [paidWith, setPaidWith] = useState<PaidWith | null>(
    existing ? (existing.moneyAccountId ?? CREDIT) : null,
  );
  const [fee, setFee] = useState(existing?.feeAmount ?? 0);
  const [contactId, setContactId] = useState<string | null>(existing?.contactId ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [withTax, setWithTax] = useState((existing?.lines ?? []).some((l) => l.taxAmount > 0));
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = sumLines(lines);

  useEffect(() => {
    if (!business.taxEnabled) return;
    setLines((ls) =>
      ls.map((l) => ({ ...l, taxAmount: withTax ? divRound(l.amount * TAX_RATE, 100) : 0 })),
    );
  }, [withTax, business.taxEnabled]);

  const updateLine = (lineId: string, patch: Partial<DocumentLine>) => {
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== lineId) return l;
        const next = { ...l, ...patch };
        if (next.itemId && (patch.quantityMilli !== undefined || patch.unitPrice !== undefined)) {
          next.amount = divRound(next.quantityMilli * next.unitPrice, 1000);
        }
        next.taxAmount = withTax && business.taxEnabled ? divRound(next.amount * TAX_RATE, 100) : 0;
        return next;
      }),
    );
  };

  const addItem = (item: Item) => {
    setPicking(false);
    const price = item.sellingPrice ?? 0;
    setLines((ls) => {
      const found = ls.find((l) => l.itemId === item.id && l.unitPrice === price);
      if (found) {
        return ls.map((l) =>
          l.id === found.id
            ? {
                ...l,
                quantityMilli: l.quantityMilli + 1000,
                amount: divRound((l.quantityMilli + 1000) * l.unitPrice, 1000),
              }
            : l,
        );
      }
      return [
        ...ls,
        newLine({
          itemId: item.id,
          quantityMilli: 1000,
          unitPrice: price,
          amount: price,
          taxAmount: withTax && business.taxEnabled ? divRound(price * TAX_RATE, 100) : 0,
        }),
      ];
    });
  };

  const addNewItem = async (name: string) => {
    const item = {
      ...repo.newItem(business.id),
      name: labelFromInput(name || t('items.new'), language),
    };
    await repo.saveItem(item);
    addItem(item);
  };

  const addAmount = () => setLines((ls) => [...ls, newLine({ amount: 0, description: '' })]);

  const submit = async () => {
    if (lines.length === 0 || total <= 0) return setError(t('sell.need_lines'));
    if (!paidWith) return setError(t('sell.need_paid_with'));
    if (paidWith === CREDIT && !contactId) return setError(t('sell.need_customer'));
    if (fee > total) return setError(t('form.fee_too_big'));
    setError(null);
    const doc: Document = {
      ...(existing ?? (await repo.newDocument(business.id, user.id, 'sale', date))),
      date,
      lines,
      total,
      moneyAccountId: paidWith === CREDIT ? null : paidWith,
      contactId,
      feeAmount: paidWith === CREDIT ? 0 : fee,
      note,
    };
    await save(doc, t('sell.saved', { amount: money(total) }), existing ? -1 : '/');
  };

  return (
    <Screen
      title={existing ? t('sell.edit_title') : t('actions.sell')}
      back
      footer={
        <div className="total-bar">
          <div>
            <div className="muted small">{t('common.total')}</div>
            <div className="total-amount">{money(total)}</div>
          </div>
          <Button onClick={() => void submit()} disabled={saving}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <Section title={t('sell.what')}>
        {lines.map((l) => {
          const item = l.itemId ? items.find((i) => i.id === l.itemId) : undefined;
          return (
            <Card key={l.id} className="line-card">
              <div className="line-head">
                {item ? (
                  <strong>{pick(item.name)}</strong>
                ) : (
                  <TextField
                    value={l.description}
                    onChange={(v) => updateLine(l.id, { description: v })}
                    placeholder={t('sell.describe')}
                  />
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('common.remove')}
                  onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                >
                  ×
                </button>
              </div>
              {item ? (
                <div className="line-fields">
                  <QuantityField
                    label={t('form.quantity')}
                    value={l.quantityMilli}
                    onChange={(q) => updateLine(l.id, { quantityMilli: q ?? 0 })}
                    unit={pick(item.unit)}
                  />
                  <AmountField
                    label={t('form.unit_price')}
                    value={l.unitPrice}
                    onChange={(p) => updateLine(l.id, { unitPrice: p ?? 0 })}
                    presets={false}
                  />
                </div>
              ) : (
                <AmountField
                  label={t('form.amount')}
                  value={l.amount || null}
                  onChange={(a) => updateLine(l.id, { amount: a ?? 0 })}
                />
              )}
              <div className="line-total muted">
                {money(l.amount)}
                {l.taxAmount ? ` + ${t('form.tax')} ${money(l.taxAmount)}` : ''}
              </div>
            </Card>
          );
        })}
        <div className="row-buttons">
          <Button kind="secondary" onClick={() => setPicking(true)}>
            + {t('sell.add_item')}
          </Button>
          <Button kind="secondary" onClick={addAmount}>
            + {t('sell.add_amount')}
          </Button>
        </div>
        {business.taxEnabled ? (
          <Toggle
            label={t('sell.add_tax', { rate: TAX_RATE })}
            checked={withTax}
            onChange={setWithTax}
          />
        ) : null}
      </Section>

      <Section>
        <PaidWithChips
          label={t('form.paid_with')}
          value={paidWith}
          onChange={(v) => setPaidWith(v)}
          creditLabel={t('form.on_credit')}
          fee={fee}
          onFee={setFee}
        />
        <ContactField
          kind="customer"
          value={contactId}
          onChange={setContactId}
          required={paidWith === CREDIT}
          label={paidWith === CREDIT ? t('form.customer') : t('form.customer_optional')}
        />
      </Section>

      <Section>
        <DateField value={date} onChange={setDate} />
        <TextField label={t('form.note')} value={note} onChange={setNote} />
        {error ? <div className="banner warn">{error}</div> : null}
      </Section>

      <ItemPicker
        open={picking}
        onPick={addItem}
        onClose={() => setPicking(false)}
        onAdd={(name) => void addNewItem(name)}
        showStock
      />
    </Screen>
  );
}
