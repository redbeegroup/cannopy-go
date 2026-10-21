/**
 * Money in Cannopy GO is Myanmar kyat stored as a whole-number integer.
 * There is no subunit in daily use, so no decimals in version 1.
 * Columns are bigint on the server so a later currency with two decimals
 * (stored as minor units) fits without a migration.
 */
export type Kyat = number;

/** The largest whole amount we accept: well below Number.MAX_SAFE_INTEGER. */
export const MAX_KYAT = 1_000_000_000_000_000; // 10^15 kyat

export class InvalidAmountError extends Error {
  constructor(value: unknown) {
    super(`Amount must be a whole number of kyat between 0 and ${MAX_KYAT}, got ${String(value)}`);
    this.name = 'InvalidAmountError';
  }
}

/** Returns true when the value is a safe, non-negative whole number of kyat. */
export function isKyat(value: unknown): value is Kyat {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_KYAT;
}

/** Throws if the value is not a valid non-negative whole-kyat amount. */
export function kyat(value: number): Kyat {
  if (!isKyat(value)) throw new InvalidAmountError(value);
  return value;
}

/** Signed version for journal lines and stock movements. */
export function isSignedKyat(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= -MAX_KYAT && value <= MAX_KYAT
  );
}

export type DigitGrouping = 'thousand' | 'lakh';
export type DisplayLanguage = 'en' | 'my';

export interface FormatKyatOptions {
  language?: DisplayLanguage;
  grouping?: DigitGrouping;
  /** Western digits are the default; Myanmar digits are a display option. */
  myanmarDigits?: boolean;
  /** Include the currency label ("Ks" or "ကျပ်"). Default true. */
  withUnit?: boolean;
}

const MYANMAR_DIGITS = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'] as const;

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Indian-style grouping used by traders who count in lakh: 12,50,000 */
function groupLakh(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/**
 * Formats a whole-kyat amount for display.
 * English: 1,250,000 Ks. Myanmar: ကျပ် 1,250,000. Lakh grouping: 12,50,000.
 */
export function formatKyat(amount: number, options: FormatKyatOptions = {}): string {
  if (!isSignedKyat(amount)) throw new InvalidAmountError(amount);
  const {
    language = 'en',
    grouping = 'thousand',
    myanmarDigits = false,
    withUnit = true,
  } = options;
  const sign = amount < 0 ? '-' : '';
  const digits = String(Math.abs(amount));
  let grouped = grouping === 'lakh' ? groupLakh(digits) : groupThousands(digits);
  if (myanmarDigits) {
    grouped = grouped.replace(/\d/g, (d) => MYANMAR_DIGITS[Number(d)] ?? d);
  }
  if (!withUnit) return `${sign}${grouped}`;
  return language === 'my' ? `ကျပ် ${sign}${grouped}` : `${sign}${grouped} Ks`;
}

/**
 * Parses typed input into whole kyat. Accepts western or Myanmar digits,
 * commas, spaces and a leading currency word. Returns null when it is not a number.
 */
export function parseKyat(input: string): Kyat | null {
  let s = input.trim().replace(/ကျပ်|Ks|MMK/gi, '');
  s = s.replace(/[၀-၉]/g, (d) =>
    String(MYANMAR_DIGITS.indexOf(d as (typeof MYANMAR_DIGITS)[number])),
  );
  s = s.replace(/[\s,]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return isKyat(n) ? n : null;
}
