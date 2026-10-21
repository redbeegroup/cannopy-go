import type { Account, Contact, Document, Item } from '@cannopy/core';
import { labelFromInput } from '@cannopy/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useContacts, useItems, useMoneyAccounts } from '../data/hooks';
import { repo } from '../data/repo';
import { useSession } from '../data/session';
import { AmountField, Field } from '../ui/fields';
import { formatQuantity, useLabel, useLanguage, useMoney } from '../ui/format';
import { Picker, PickerButton } from '../ui/Picker';
import { useToast } from '../ui/Toast';

/** Pieces shared by the Sell, Spend, Buy and payment screens. */

export const CREDIT = 'credit' as const;
export type PaidWith = string | typeof CREDIT;

/**
 * "How was it paid": one chip per money account plus "On credit" (or "Not paid
 * yet"). A wallet with a default fee pre-fills the fee field.
 */
export function PaidWithChips({
  value,
  onChange,
  creditLabel,
  fee,
  onFee,
  feeLabel,
  allowCredit = true,
  label,
}: {
  value: PaidWith | null;
  onChange(v: PaidWith, account: Account | null): void;
  creditLabel: string;
  fee: number;
  onFee(fee: number): void;
  feeLabel?: string | undefined;
  allowCredit?: boolean | undefined;
  label: string;
}) {
  const accounts = useMoneyAccounts();
  const pick = useLabel();
  const { t } = useTranslation();
  const selected = accounts.find((a) => a.id === value) ?? null;
  return (
    <>
      <Field label={label}>
        <div className="choices wrap" role="radiogroup">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={value === a.id}
              className={`chip choice ${value === a.id ? 'selected' : ''}`}
              onClick={() => {
                onChange(a.id, a);
                if (a.moneyKind === 'wallet' && a.defaultFee) onFee(a.defaultFee);
                else onFee(0);
              }}
            >
              {a.provider || pick(a.name)}
            </button>
          ))}
          {allowCredit ? (
            <button
              type="button"
              role="radio"
              aria-checked={value === CREDIT}
              className={`chip choice credit ${value === CREDIT ? 'selected' : ''}`}
              onClick={() => {
                onChange(CREDIT, null);
                onFee(0);
              }}
            >
              {creditLabel}
            </button>
          ) : null}
        </div>
      </Field>
      {selected && selected.moneyKind !== 'cash' ? (
        <AmountField
          label={feeLabel ?? t('form.fee')}
          value={fee || null}
          onChange={(v) => onFee(v ?? 0)}
          presets={false}
        />
      ) : null}
    </>
  );
}

/** Customer or supplier picker with a "new" row that creates the contact on the spot. */
export function ContactField({
  kind,
  value,
  onChange,
  label,
  error,
  required,
}: {
  kind: 'customer' | 'supplier';
  value: string | null;
  onChange(id: string | null): void;
  label?: string | undefined;
  error?: string | null | undefined;
  required?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const { business } = useSession();
  const language = useLanguage();
  const pick = useLabel();
  const contacts = useContacts();
  const [open, setOpen] = useState(false);
  const relevant = contacts.filter((c) => (kind === 'customer' ? c.isCustomer : c.isSupplier));
  const others = contacts.filter((c) => !relevant.includes(c));
  const options = [...relevant, ...others].map((c) => ({
    key: c.id,
    value: c.id,
    title: pick(c.name),
    subtitle: c.phone ?? undefined,
  }));
  const current = contacts.find((c) => c.id === value);
  const add = async (text: string) => {
    const contact: Contact = {
      ...repo.newContact(business.id),
      name: labelFromInput(
        text || t(kind === 'customer' ? 'contacts.new_customer' : 'contacts.new_supplier'),
        language,
      ),
      isCustomer: kind === 'customer',
      isSupplier: kind === 'supplier',
    };
    await repo.saveContact(contact);
    onChange(contact.id);
    setOpen(false);
  };
  return (
    <>
      <PickerButton
        label={label ?? t(kind === 'customer' ? 'form.customer' : 'form.supplier')}
        value={current ? pick(current.name) : null}
        placeholder={t(kind === 'customer' ? 'form.pick_customer' : 'form.pick_supplier')}
        onClick={() => setOpen(true)}
        error={error}
        onClear={required ? undefined : () => onChange(null)}
      />
      <Picker
        open={open}
        title={t(kind === 'customer' ? 'form.customer' : 'form.supplier')}
        options={options}
        onPick={(id) => {
          onChange(id);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onAdd={(text) => void add(text)}
        addLabel={t(kind === 'customer' ? 'contacts.new_customer' : 'contacts.new_supplier')}
      />
    </>
  );
}

/** Item picker; the caller decides what happens with the picked item. */
export function ItemPicker({
  open,
  onPick,
  onClose,
  onAdd,
  showStock,
}: {
  open: boolean;
  onPick(item: Item): void;
  onClose(): void;
  onAdd?: ((name: string) => void) | undefined;
  showStock?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const items = useItems();
  const pick = useLabel();
  const money = useMoney();
  const options = items.map((i) => ({
    key: i.id,
    value: i,
    title: pick(i.name),
    subtitle:
      showStock && i.type === 'stocked'
        ? `${t('items.in_stock')}: ${formatQuantity(i.quantityOnHandMilli)} ${pick(i.unit)}`
        : i.type === 'service'
          ? t('items.type.service')
          : undefined,
    right: i.sellingPrice !== null ? money(i.sellingPrice) : undefined,
    keywords: i.barcode ?? '',
  }));
  return (
    <Picker
      open={open}
      title={t('form.pick_item')}
      options={options}
      onPick={onPick}
      onClose={onClose}
      onAdd={onAdd}
      addLabel={t('items.new')}
    />
  );
}

/** Saving a document: toast, go back, and surface failures in plain words. */
export function useSaveDocument() {
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const save = async (doc: Document, done: string, to: string | number = -1) => {
    setSaving(true);
    try {
      await repo.saveDocument(doc);
      toast(done);
      if (typeof to === 'number') navigate(to);
      else navigate(to, { replace: true });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.save_failed'), 'warn');
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}

export function sumLines(lines: Document['lines']): number {
  return lines.reduce((s, l) => s + l.amount + l.taxAmount, 0);
}
