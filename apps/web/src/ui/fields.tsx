import { parseKyat } from '@cannopy/core';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toUnicodeMyanmar } from '../myanmar/zawgyi';
import { formatQuantity, parseQuantity, useMoney } from './format';

/**
 * Form controls sized for a thumb. Every text field converts Zawgyi to
 * Unicode when the owner leaves it, so only Unicode reaches the store.
 */

export function Field({
  label,
  hint,
  error,
  children,
  inline,
}: {
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | null | undefined;
  children: ReactNode;
  inline?: boolean | undefined;
}) {
  return (
    <div className={`field ${inline ? 'field-inline' : ''} ${error ? 'has-error' : ''}`}>
      {label ? <span className="field-label">{label}</span> : null}
      {children}
      {error ? (
        <div className="field-error">{error}</div>
      ) : hint ? (
        <div className="field-hint">{hint}</div>
      ) : null}
    </div>
  );
}

interface TextFieldProps {
  label?: string | undefined;
  value: string;
  onChange(value: string): void;
  placeholder?: string | undefined;
  hint?: string | undefined;
  error?: string | null | undefined;
  type?: 'text' | 'tel';
  autoFocus?: boolean | undefined;
  multiline?: boolean | undefined;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  type = 'text',
  autoFocus,
  multiline,
}: TextFieldProps) {
  const id = useId();
  const normalise = () => {
    const fixed = toUnicodeMyanmar(value);
    if (fixed !== value) onChange(fixed);
  };
  return (
    <Field label={label} hint={hint} error={error}>
      {multiline ? (
        <textarea
          id={id}
          className="input"
          value={value}
          placeholder={placeholder}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
          onBlur={normalise}
        />
      ) : (
        <input
          id={id}
          className="input"
          type={type}
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onBlur={normalise}
          autoComplete="off"
        />
      )}
    </Field>
  );
}

/** Whole kyat with the quick-note presets from the scope doc. */
export function AmountField({
  label,
  value,
  onChange,
  presets = [500, 1000, 5000, 10_000],
  big,
  error,
  hint,
  autoFocus,
}: {
  label?: string | undefined;
  value: number | null;
  onChange(value: number | null): void;
  presets?: number[] | false;
  big?: boolean | undefined;
  error?: string | null | undefined;
  hint?: string | undefined;
  autoFocus?: boolean | undefined;
}) {
  const money = useMoney();
  const [text, setText] = useState(value === null ? '' : money(value, false));
  useEffect(() => {
    const parsed = parseKyat(text);
    if (parsed !== value) setText(value === null ? '' : money(value, false));
    // Only resync when the value changes from outside; typing updates text first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (next: string) => {
    setText(next);
    onChange(next.trim() === '' ? null : parseKyat(next));
  };
  return (
    <Field label={label} error={error} hint={hint}>
      <div className={`amount-input ${big ? 'big' : ''}`}>
        <input
          className="input"
          inputMode="numeric"
          value={text}
          placeholder="0"
          autoFocus={autoFocus}
          onChange={(e) => update(e.target.value)}
          onBlur={() => {
            if (value !== null) setText(money(value, false));
          }}
        />
        <span className="unit">Ks</span>
      </div>
      {presets ? (
        <div className="presets">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              className="chip"
              onClick={() => {
                const next = (value ?? 0) + p;
                setText(money(next, false));
                onChange(next);
              }}
            >
              +{money(p, false)}
            </button>
          ))}
          {value ? (
            <button
              type="button"
              className="chip chip-clear"
              onClick={() => {
                setText('');
                onChange(null);
              }}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}
    </Field>
  );
}

/** Quantity in thousandths, typed as a decimal, with a stepper for whole units. */
export function QuantityField({
  label,
  value,
  onChange,
  unit,
  error,
  allowNegative,
}: {
  label?: string | undefined;
  value: number | null;
  onChange(milli: number | null): void;
  unit?: string | undefined;
  error?: string | null | undefined;
  allowNegative?: boolean | undefined;
}) {
  const [text, setText] = useState(value === null ? '' : formatQuantity(value));
  useEffect(() => {
    if (parseQuantity(text) !== value) setText(value === null ? '' : formatQuantity(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const step = (delta: number) => {
    const next = Math.max(allowNegative ? Number.NEGATIVE_INFINITY : 0, (value ?? 0) + delta);
    setText(formatQuantity(next));
    onChange(next);
  };
  return (
    <Field label={label} error={error}>
      <div className="qty-input">
        <button type="button" className="stepper" onClick={() => step(-1000)} aria-label="-1">
          −
        </button>
        <input
          className="input"
          inputMode="decimal"
          value={text}
          placeholder="0"
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.trim() === '' ? null : parseQuantity(e.target.value));
          }}
        />
        <button type="button" className="stepper" onClick={() => step(1000)} aria-label="+1">
          +
        </button>
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
    </Field>
  );
}

export function DateField({
  label,
  value,
  onChange,
}: {
  label?: string | undefined;
  value: string;
  onChange(date: string): void;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label ?? t('common.date')}>
      <input
        className="input"
        type="date"
        value={value}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
      />
    </Field>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  hint?: string | undefined;
}) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        <span>{label}</span>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

/** A row of choices where exactly one is picked. */
export function Choice<const T extends string>({
  label,
  value,
  options,
  onChange,
  wrap,
}: {
  label?: string | undefined;
  value: T | null;
  options: { value: T; label: string; hint?: string }[];
  onChange(value: T): void;
  wrap?: boolean | undefined;
}) {
  return (
    <Field label={label}>
      <div className={`choices ${wrap ? 'wrap' : ''}`} role="radiogroup">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={`chip choice ${value === o.value ? 'selected' : ''}`}
            onClick={() => onChange(o.value)}
          >
            <span>{o.label}</span>
            {o.hint ? <span className="chip-hint">{o.hint}</span> : null}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function Button({
  children,
  onClick,
  kind = 'primary',
  disabled,
  type = 'button',
  full,
  small,
}: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean | undefined;
  type?: 'button' | 'submit';
  full?: boolean | undefined;
  small?: boolean | undefined;
}) {
  return (
    <button
      type={type}
      className={`button ${kind} ${full ? 'full' : ''} ${small ? 'small' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
