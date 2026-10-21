import { z } from 'zod';

export type Language = 'en' | 'my';
export const languageSchema = z.enum(['en', 'my']);

/**
 * Every account, item, category and report label is stored as a pair of strings.
 * System records ship with both. Owner-created names store the typed string and
 * an optional translation; display falls back to whichever language was typed.
 */
export const bilingualSchema = z.object({
  en: z.string().trim().max(200).default(''),
  my: z.string().trim().max(200).default(''),
});
export type Bilingual = z.infer<typeof bilingualSchema>;

export function bilingual(en: string, my = ''): Bilingual {
  return { en, my };
}

/** Picks the label in the preferred language, falling back to the other one. */
export function pickLabel(label: Bilingual, language: Language): string {
  const primary = label[language];
  if (primary) return primary;
  return language === 'en' ? label.my : label.en;
}

/** A label typed in only one language is stored under that language. */
export function labelFromInput(text: string, language: Language): Bilingual {
  return language === 'my' ? { en: '', my: text } : { en: text, my: '' };
}

/**
 * Myanmar text is stored as Unicode only. Zawgyi input must be detected and
 * converted at the input boundary (web app) before it reaches the API; see
 * docs/architecture.md, decision 9. This is the type-level marker for text that
 * has passed that boundary.
 */
export type UnicodeMyanmarText = string & { readonly __unicodeMyanmar: true };
