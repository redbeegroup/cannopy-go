import { describe, expect, it } from 'vitest';
import en from './en.json';
import my from './my.json';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('translations', () => {
  it('have the same keys in English and Myanmar', () => {
    expect(keys(my).sort()).toEqual(keys(en).sort());
  });

  it('store Myanmar text as Unicode, not Zawgyi', () => {
    // Zawgyi uses code points in the U+1060-U+109F range that Unicode Myanmar rarely needs
    // for these labels; a crude guard that catches a pasted Zawgyi string.
    const text = JSON.stringify(my);
    expect(/[ၠ-႗]/.test(text)).toBe(false);
  });
});
