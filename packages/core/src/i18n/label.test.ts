import { describe, expect, it } from 'vitest';
import { bilingual, labelFromInput, pickLabel } from './label.js';

describe('bilingual labels', () => {
  const cash = bilingual('Cash in hand', 'လက်ထဲငွေသား');

  it('returns the preferred language', () => {
    expect(pickLabel(cash, 'en')).toBe('Cash in hand');
    expect(pickLabel(cash, 'my')).toBe('လက်ထဲငွေသား');
  });

  it('falls back when the translation is empty', () => {
    const typedInMyanmar = labelFromInput('လက်ဖက်ရည်', 'my');
    expect(pickLabel(typedInMyanmar, 'en')).toBe('လက်ဖက်ရည်');
    const typedInEnglish = labelFromInput('Tea', 'en');
    expect(pickLabel(typedInEnglish, 'my')).toBe('Tea');
  });
});
