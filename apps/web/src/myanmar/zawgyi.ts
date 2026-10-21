import { getAllRulesZ2U, getAllRulesZNorm, type TranslitRule } from './zawgyi-rules';

/**
 * Zawgyi handling at the input boundary (architecture doc, data conventions:
 * "Myanmar text is Unicode only; Zawgyi is detected and converted at input").
 *
 * Conversion uses Google's myanmar-tools transliteration rules (vendored in
 * ./zawgyi-rules.ts) with the same phase runner. Detection is a small set of
 * structural checks instead of the upstream Markov model, because the npm
 * package does not ship the model for browsers: Zawgyi encodes the e-vowel
 * before its consonant, uses U+1039 as the asat (Unicode uses it only to
 * stack consonants), starts words with a medial, and uses code points that
 * Unicode Myanmar reserves for Mon, Shan and Karen. Any of those marks a
 * string as Zawgyi. Valid Unicode never triggers them, so the worst case is
 * Zawgyi that slips through, not Unicode that is mangled.
 */

// Code points are written as characters; the ranges are U+1000-109F, U+AA60-AA7F, U+A9E0-A9FF.
const MYANMAR = /[က-႟ꩠ-ꩿꧠ-꧿]/;
const CONSONANT = '[က-အ]';
// U+1033, U+1034, U+105A and U+1060-1097: Mon, Shan and Karen in Unicode, medials in Zawgyi.
const ZAWGYI_ONLY = /[ဳဴၚၠ-႗]/;
// U+1031 (e-vowel) at the start of a word, directly before a consonant.
const E_VOWEL_FIRST = new RegExp(`(^|[^က-႟])ေ${CONSONANT}`);
// U+1039 not followed by a consonant: an asat in Zawgyi, never valid Unicode.
const ASAT_1039 = /္(?![က-အ])/;
/** A medial or asat at the start of a word: Zawgyi writes ya-yit and ya-pin before the consonant. */
const MEDIAL_FIRST = /(^|[^က-႟])[်ျြွှ]/;

export function isMyanmarText(text: string): boolean {
  return MYANMAR.test(text);
}

/** True when the text is Zawgyi encoded (see the module note on how). */
export function isZawgyi(text: string): boolean {
  if (!isMyanmarText(text)) return false;
  return (
    ZAWGYI_ONLY.test(text) ||
    E_VOWEL_FIRST.test(text) ||
    ASAT_1039.test(text) ||
    MEDIAL_FIRST.test(text)
  );
}

function runPhase(rules: TranslitRule[], input: string): string {
  let out = '';
  let mid = input;
  let startOfString = true;
  while (mid.length > 0) {
    let found = false;
    for (const rule of rules) {
      if (rule.matchOnStart === undefined || startOfString) {
        const m = mid.match(rule.p);
        if (m) {
          found = true;
          const rightPartSize = mid.length - m[0].length;
          mid = mid.replace(rule.p, rule.s);
          const newStart = mid.length - rightPartSize;
          if (rule.revisit === undefined) {
            out += mid.substring(0, newStart);
            mid = mid.substring(newStart);
          }
        }
      }
    }
    if (!found) {
      out += mid[0];
      mid = mid.substring(1);
    }
    startOfString = false;
  }
  return out;
}

function runAllPhases(all: TranslitRule[][], input: string): string {
  let out = input;
  for (const rules of all) out = runPhase(rules, out);
  return out;
}

let z2u: TranslitRule[][] | null = null;
let znorm: TranslitRule[][] | null = null;

export function zawgyiToUnicode(text: string): string {
  z2u ??= getAllRulesZ2U();
  znorm ??= getAllRulesZNorm();
  return runAllPhases(z2u, runAllPhases(znorm, text));
}

/** What every text field stores: Zawgyi converted, everything else untouched. */
export function toUnicodeMyanmar(text: string): string {
  return isZawgyi(text) ? zawgyiToUnicode(text) : text;
}
