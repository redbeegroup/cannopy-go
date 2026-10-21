import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toUnicodeMyanmar } from '../myanmar/zawgyi';

/**
 * Bottom sheet list for picking an item, a customer, an account. Searchable,
 * with an optional "add new" row at the top so a sale is never blocked by a
 * missing customer.
 */
export interface PickerOption<T> {
  key: string;
  value: T;
  title: string;
  subtitle?: string | undefined;
  right?: ReactNode | undefined;
  /** Extra text the search matches. */
  keywords?: string | undefined;
}

interface PickerProps<T> {
  open: boolean;
  title: string;
  options: PickerOption<T>[];
  onPick(value: T): void;
  onClose(): void;
  onAdd?: ((text: string) => void) | undefined;
  addLabel?: string | undefined;
  searchable?: boolean | undefined;
  emptyText?: string | undefined;
}

export function Picker<T>({
  open,
  title,
  options,
  onPick,
  onClose,
  onAdd,
  addLabel,
  searchable = true,
  emptyText,
}: PickerProps<T>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const shown = useMemo(() => {
    const q = toUnicodeMyanmar(query).trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.title} ${o.subtitle ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>
        {searchable ? (
          <input
            className="input search"
            placeholder={t('common.search')}
            value={query}
            autoFocus={options.length > 6}
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : null}
        <div className="sheet-list">
          {onAdd ? (
            <button
              type="button"
              className="list-row add-row"
              onClick={() => onAdd(toUnicodeMyanmar(query.trim()))}
            >
              <span className="row-main">
                <span className="row-title">
                  + {addLabel ?? t('common.add')}
                  {query.trim() ? ` “${query.trim()}”` : ''}
                </span>
              </span>
            </button>
          ) : null}
          {shown.length === 0 && !onAdd ? (
            <div className="muted pad">{emptyText ?? t('common.nothing_found')}</div>
          ) : null}
          {shown.map((o) => (
            <button key={o.key} type="button" className="list-row" onClick={() => onPick(o.value)}>
              <span className="row-main">
                <span className="row-title">{o.title}</span>
                {o.subtitle ? <span className="row-sub">{o.subtitle}</span> : null}
              </span>
              {o.right !== undefined ? <span className="row-right">{o.right}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A tappable field that opens a picker. */
export function PickerButton({
  label,
  value,
  placeholder,
  onClick,
  error,
  onClear,
}: {
  label?: string | undefined;
  value: string | null;
  placeholder: string;
  onClick(): void;
  error?: string | null | undefined;
  onClear?: (() => void) | undefined;
}) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      {label ? <span className="field-label">{label}</span> : null}
      <div className="picker-button-wrap">
        <button
          type="button"
          className={`input picker-button ${value ? '' : 'placeholder'}`}
          onClick={onClick}
        >
          <span>{value ?? placeholder}</span>
          <span aria-hidden="true" className="chev">
            ▾
          </span>
        </button>
        {value && onClear ? (
          <button type="button" className="icon-button" onClick={onClear} aria-label="×">
            ×
          </button>
        ) : null}
      </div>
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}

/** Yes / no question before something that cannot be undone. */
export function Confirm({
  open,
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text?: string | undefined;
  confirmLabel: string;
  danger?: boolean | undefined;
  onConfirm(): void;
  onClose(): void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet confirm"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {text ? <p className="muted">{text}</p> : null}
        <div className="confirm-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`button ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
