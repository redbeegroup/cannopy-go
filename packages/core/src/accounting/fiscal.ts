/** Fiscal year helpers. Dates are YYYY-MM-DD strings in the business's local calendar. */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** First and last day of the fiscal year that contains `date`. */
export function fiscalYearRange(
  date: string,
  startMonth: number,
): { from: string; to: string; label: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  const from = `${startYear}-${pad(startMonth)}-01`;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const to = `${endYear}-${pad(endMonth)}-${pad(daysInMonth(endYear, endMonth))}`;
  const label = startMonth === 1 ? String(startYear) : `${startYear}-${String(endYear).slice(2)}`;
  return { from, to, label };
}

/** First and last day of the calendar month that contains `date`. */
export function monthRange(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`,
  };
}

/** The day before a date, for opening balances dated before the start date. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
