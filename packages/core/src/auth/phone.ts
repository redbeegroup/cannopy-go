/**
 * Phone numbers are the login identity (docs/architecture.md, decision 8).
 * They are stored in E.164 form (+959...) so the same owner typed as
 * "09 123 456 789", "+95 9123456789" or "၀၉၁၂၃၄၅၆၇၈၉" is one user.
 *
 * Runs on the device too, so the sign-in screen can tell the owner about a
 * bad number before asking the server for a code.
 */

const MYANMAR_DIGITS = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];

/** Default country for numbers typed without a country code. */
export const DEFAULT_COUNTRY_CODE = '95';

export function normalizePhone(input: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  let s = input.trim().replace(/[၀-၉]/g, (d) => String(MYANMAR_DIGITS.indexOf(d)));
  s = s.replace(/[\s().-]/g, '');
  if (s === '') return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (s.startsWith('+')) {
    s = `+${s.slice(1).replace(/\D/g, '')}`;
  } else {
    if (/\D/.test(s)) return null;
    if (s.startsWith('0')) s = `+${countryCode}${s.slice(1)}`;
    else if (s.startsWith(countryCode) && s.length >= 10) s = `+${s}`;
    else s = `+${countryCode}${s}`;
  }
  return isE164(s) ? s : null;
}

/** E.164: a plus, a non-zero first digit, 7 to 15 digits in all. */
export function isE164(s: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(s);
}

/** "+959123456789" shown as "09 123 456 789" for Myanmar numbers, unchanged otherwise. */
export function formatPhone(phone: string): string {
  const m = /^\+95(\d+)$/.exec(phone);
  if (!m) return phone;
  const local = `0${m[1]}`;
  return local.replace(/^(\d{2})(\d{3})(\d{3})(\d+)$/, '$1 $2 $3 $4');
}
