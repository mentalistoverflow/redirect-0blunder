/**
 * i18n module — loads translations from JSON locale files.
 */

const SUPPORTED_LANGS = ['fr', 'en', 'es'];
const DEFAULT_LANG = 'fr';

let currentLang = localStorage.getItem('chess-learn-lang') || DEFAULT_LANG;
let translations = {};
let loaded = false;

/**
 * Load translations for a language from JSON file.
 */
async function loadTranslations(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = DEFAULT_LANG;
  try {
    const url = `/static/locales/${lang}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    translations[lang] = await res.json();
  } catch (e) {
    console.warn(`i18n: failed to load ${lang}.json:`, e);
    if (lang !== DEFAULT_LANG && !translations[DEFAULT_LANG]) {
      await loadTranslations(DEFAULT_LANG);
    }
  }
}

/**
 * Initialize i18n — must be called before first t() usage.
 */
export async function initI18n() {
  if (loaded) return;
  // Detect browser language on first visit if no preference saved
  if (!localStorage.getItem('chess-learn-lang')) {
    const browserLang = navigator.language?.split('-')[0]?.toLowerCase();
    if (SUPPORTED_LANGS.includes(browserLang)) {
      currentLang = browserLang;
    }
  }
  await loadTranslations(currentLang);
  if (currentLang !== DEFAULT_LANG) {
    await loadTranslations(DEFAULT_LANG); // Fallback
  }
  loaded = true;
}

/**
 * Translate a key with optional parameter substitution.
 */
export function t(key, params = {}) {
  const dict = translations[currentLang] || translations[DEFAULT_LANG] || {};
  let text = dict[key];
  if (text === undefined && currentLang !== DEFAULT_LANG) {
    text = (translations[DEFAULT_LANG] || {})[key];
  }
  if (text === undefined) return key;

  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return text;
}

export function getLang() {
  return currentLang;
}

export async function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return;
  currentLang = lang;
  localStorage.setItem('chess-learn-lang', lang);
  if (!translations[lang]) {
    await loadTranslations(lang);
  }
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

export function getLocale() {
  const map = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };
  return map[currentLang] || 'fr-FR';
}

// SVG flags — cross-platform (Windows doesn't render emoji flags)
const FLAG_SVG = {
  fr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="20" height="15" class="lang-flag"><rect width="213.3" height="480" fill="#002654"/><rect x="213.3" width="213.4" height="480" fill="#fff"/><rect x="426.7" width="213.3" height="480" fill="#ce1126"/></svg>',
  en: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="20" height="15" class="lang-flag"><rect width="640" height="480" fill="#012169"/><path d="M75 0l244 181L562 0h78v62L400 241l240 178v61h-80L320 301 81 480H0v-60l239-178L0 64V0z" fill="#fff"/><path d="M424 281l216 159v40L369 281zm-184 20l6 35L54 480H0zM640 0v3L391 191l2-44L590 0zM0 0l239 176h-60L0 42z" fill="#C8102E"/><path d="M241 0v480h160V0zM0 160v160h640V160z" fill="#fff"/><path d="M0 193v96h640v-96zM273 0v480h96V0z" fill="#C8102E"/></svg>',
  es: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="20" height="15" class="lang-flag"><rect width="640" height="480" fill="#c60b1e"/><rect y="120" width="640" height="240" fill="#ffc400"/></svg>',
};

export function getAvailableLanguages() {
  return [
    { code: 'fr', label: 'Français', flag: FLAG_SVG.fr },
    { code: 'en', label: 'English', flag: FLAG_SVG.en },
    { code: 'es', label: 'Español', flag: FLAG_SVG.es },
  ];
}
