import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import am from './am';
import en from './en';

i18n.use(initReactI18next).init({
  resources: {
    am: { translation: am },
    en: { translation: en },
  },
  lng: 'am',          // Amharic is default
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
