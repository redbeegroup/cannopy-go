import {
  type Document,
  type DocumentLine,
  divRound,
  type Item,
  labelFromInput,
} from '@cannopy/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useDocument, useItems } from '../data/hooks';
import { newLine, repo } from '../data/repo';
import { useSession } from '../data/session';
import { AmountField, Button, DateField, QuantityField, TextField } from '../ui/fields';
import { formatQuantity, today, useLabel, useLanguage, useMoney } from '../ui/format';
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
 * Buy stock (scope doc, journey 4): supplier, items with quantity and unit
 * cost, paid now or owed. Stocked items go to Stock on hand at cost and the
 * average cost updates on the server; untracked items are expensed.
 */
export function Buy() {
  const { id } = useParams();
  const existing = useDocument(id);
  if (id && !existing) return null;
  return <BuyForm key={existing?.id ?? 'new'} existing={existing} />;
}

function BuyForm({ existing }: { existing?: Document | undefined }) {
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
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = sumLines(lines);

  const updateLine = (lineId: string, patch: Partial<DocumentLine>) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== lineId) return l;
        const next = { ...l, ...patch };
        next.amount = divRound(next.quantityMilli * next.unitPrice, 1000);
        return next;
      }),
    );

  const addItem = (item: Item) => {
    setPicking(false);
    const cost = item.lastCost ?? item.averageCost ?? 0;
    setLines((ls) => [
      ...ls,
      newLine({ itemId: item.id, quantityMilli: 1000, unitPrice: cost, amount: cost }),
    ]);
  };

  const addNewItem = async (name: string) => {
    const item = {
      ...repo.newItem(business.id),
      name: labelFromInput(name || t('items.new'), language),
    };
    await repo.saveItem(item);
    addItem(item);
  };

  const submit = async () => {
    if (lines.length === 0 || total <= 0) return setError(t('buy.need_lines'));
    if (!paidWith) return setError(t('buy.need_paid_with'));
    if (paidWith === CREDIT && !contactId) return setError(t('spend.need_supplier'));
    setError(null);
    const doc: Document = {
      ...(existing ?? (await repo.newDocument(business.id, user.id, 'purchase', date))),
      date,
      lines,
      total,
      moneyAccountId: paidWith === CREDIT ? null : paidWith,
      contactId,
      feeAmount: paidWith === CREDIT ? 0 : fee,
      note,
    };
    await save(doc, t('buy.saved', { amount: money(total) }), existing ? -1 : '/');
  };

  return (
    <Screen
      title={existing ? t('buy.edit_title') : t('actions.buy')}
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
      <Section title={t('buy.what')}>
        {lines.map((l) => {
          const item = items.find((i) => i.id === l.itemId);
          return (
            <Card key={l.id} className="line-card">
              <div className="line-head">
                <strong>{item ? pick(item.name) : l.description}</strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('common.remove')}
                  onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                >
                  ×
                </button>
              </div>
              <div className="line-fields">
                <QuantityField
                  label={t('form.quantity')}
                  value={l.quantityMilli}
                  onChange={(q) => updateLine(l.id, { quantityMilli: q ?? 0 })}
                  unit={item ? pick(item.unit) : undefined}
                />
                <AmountField
                  label={t('form.unit_cost')}
                  value={l.unitPrice}
                  onChange={(p) => updateLine(l.id, { unitPrice: p ?? 0 })}
                  presets={false}
                />
              </div>
              <div className="line-total muted">
                {money(l.amount)}
                {item && item.type === 'stocked'
                  ? ` · ${t('items.in_stock')}: ${formatQuantity(item.quantityOnHandMilli)}`
                  : item
                    ? ` · ${t('buy.not_tracked')}`
                    : ''}
              </div>
            </Card>
          );
        })}
        <Button kind="secondary" onClick={() => setPicking(true)}>
          + {t('sell.add_item')}
        </Button>
      </Section>

      <Section>
        <PaidWithChips
          label={t('form.paid_from')}
          value={paidWith}
          onChange={(v) => setPaidWith(v)}
          creditLabel={t('form.owed_to_supplier')}
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
