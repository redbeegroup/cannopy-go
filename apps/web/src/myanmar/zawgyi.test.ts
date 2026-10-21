import { describe, expect, it } from 'vitest';
import { isZawgyi, toUnicodeMyanmar, zawgyiToUnicode } from './zawgyi';

describe('zawgyi detection and conversion', () => {
  it('leaves Unicode Myanmar and Latin text alone', () => {
    for (const s of ['ကျောင်း', 'ရေကန်', 'မြန်မာ', 'ဗုဒ္ဓ', 'Cannopy GO', 'ဆိုင်ခန်းငှားခ']) {
      expect(isZawgyi(s), s).toBe(false);
      expect(toUnicodeMyanmar(s)).toBe(s);
    }
  });

  it('detects the e-vowel before its consonant and the Zawgyi asat', () => {
    expect(isZawgyi('ေက်ာင္း')).toBe(true);
    expect(isZawgyi('ကန္')).toBe(true);
    expect(isZawgyi('ျမန္မာ')).toBe(true);
  });

  it('converts common Zawgyi words to Unicode', () => {
    expect(zawgyiToUnicode('ျမန္မာ')).toBe('မြန်မာ');
    expect(zawgyiToUnicode('ေက်ာင္း')).toBe('ကျောင်း');
    expect(toUnicodeMyanmar('ဆိုင္ခန္း')).toBe('ဆိုင်ခန်း');
  });
});
