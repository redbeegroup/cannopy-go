import { type Bilingual, formatKyat, type Language, pickLabel } from '@cannopy/core';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionState } from '../data/session';

export function useLanguage(): Language {
  const { i18n } = useTranslation();
  return i18n.language === 'en' ? 'en' : 'my';
}

/** Picks the owner's language from a bilingual label, falling back to whichever was typed. */
export function useLabel(): (label: Bilingual) => string {
  const language = useLanguage();
  return useCallback((label: Bilingual) => pickLabel(label, language), [language]);
}

/** Whole-kyat formatter that follows the language and the business display settings. */
export function useMoney(): (amount: number, withUnit?: boolean) => string {
  const language = useLanguage();
  const { session } = useSessionState();
  const grouping = session?.business.digitGrouping ?? 'thousand';
  const myanmarDigits = session?.business.myanmarDigits ?? false;
  return useCallback(
    (amount: number, withUnit = true) =>
      formatKyat(amount, { language, grouping, myanmarDigits, withUnit }),
    [language, grouping, myanmarDigits],
  );
}

export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Short date for lists: 21 Oct 2026. Falls back to the ISO date where the locale is missing. */
export function formatDate(date: string, language: Language): string {
  try {
    const d = new Date(`${date}T00:00:00`);
    return new Intl.DateTimeFormat(language === 'my' ? 'my-MM' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return date;
  }
}

export function formatTime(instant: string, language: Language): string {
  try {
    return new Intl.DateTimeFormat(language === 'my' ? 'my-MM' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    }).format(new Date(instant));
  } catch {
    return instant;
  }
}

/** Quantities are stored in thousandths; show up to three decimals without trailing zeros. */
export function formatQuantity(milli: number): string {
  const sign = milli < 0 ? '-' : '';
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const frac = abs % 1000;
  if (frac === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(frac).padStart(3, '0').replace(/0+$/, '')}`;
}

/** Parses "1.5" or "၁.၅" into thousandths; null when it is not a number. */
export function parseQuantity(input: string): number | null {
  const digits = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];
  let s = input.trim().replace(/[၀-၉]/g, (d) => String(digits.indexOf(d)));
  s = s.replace(/[\s,]/g, '');
  if (!/^-?\d*(\.\d{0,3})?$/.test(s) || s === '' || s === '-' || s === '.') return null;
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  const [whole = '0', frac = ''] = s.split('.');
  const milli = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
  return negative ? -milli : milli;
}
