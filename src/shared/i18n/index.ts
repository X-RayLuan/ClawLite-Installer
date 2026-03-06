import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import enCommon from './locales/en/common.json'
import enSteps from './locales/en/steps.json'
import enManagement from './locales/en/management.json'
import enProviders from './locales/en/providers.json'

const i18n = i18next.createInstance()

i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, steps: enSteps, management: enManagement, providers: enProviders }
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'steps', 'management', 'providers'],
  interpolation: { escapeValue: false }
})

export default i18n
