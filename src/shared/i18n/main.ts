import i18next from 'i18next'

import enCommon from './locales/en/common.json'
import enMain from './locales/en/main.json'

const i18nMain = i18next.createInstance()

i18nMain.init({
  resources: {
    en: { common: enCommon, main: enMain }
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'main',
  ns: ['common', 'main'],
  interpolation: { escapeValue: false }
})

export const t = i18nMain.t.bind(i18nMain)

export const initI18nMain = async (_lng: string): Promise<void> => {
  await i18nMain.changeLanguage('en')
}

export default i18nMain
