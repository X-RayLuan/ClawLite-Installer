import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import enCommon from './locales/en/common.json'
import enSteps from './locales/en/steps.json'
import enManagement from './locales/en/management.json'
import enProviders from './locales/en/providers.json'
import enActivation from './locales/en/activation.json'

import zhCommon from './locales/zh/common.json'
import zhSteps from './locales/zh/steps.json'
import zhManagement from './locales/zh/management.json'
import zhProviders from './locales/zh/providers.json'
import zhActivation from './locales/zh/activation.json'

import jaCommon from './locales/ja/common.json'
import jaSteps from './locales/ja/steps.json'
import jaManagement from './locales/ja/management.json'
import jaProviders from './locales/ja/providers.json'
import jaActivation from './locales/ja/activation.json'

const i18n = i18next.createInstance()

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      steps: enSteps,
      management: enManagement,
      providers: enProviders,
      activation: enActivation
    },
    zh: {
      common: zhCommon,
      steps: zhSteps,
      management: zhManagement,
      providers: zhProviders,
      activation: zhActivation
    },
    ja: {
      common: jaCommon,
      steps: jaSteps,
      management: jaManagement,
      providers: jaProviders,
      activation: jaActivation
    }
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'steps', 'management', 'providers', 'activation'],
  interpolation: { escapeValue: false }
})

export default i18n
