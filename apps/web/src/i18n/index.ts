import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import my from './my.json';

export const LANGUAGE_KEY = 'cannopy.language';

function savedLanguage(): 'en' | 'my' {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    return v === 'en' || v === 'my' ? v : 'my';
  } catch {
    return 'my';
  }
}

export const resources = { en: { translation: en }, my: { translation: my } } as const;

i18next.use(initReactI18next).init({
  resources,
  lng: savedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18next.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(LANGUAGE_KEY, lng);
  } catch {
    // Private mode or blocked storage: the language just does not persist.
  }
});

export default i18next;
