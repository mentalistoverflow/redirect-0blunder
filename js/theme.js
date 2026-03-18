/**
 * Theme switcher — manages DaisyUI custom themes via data-theme attribute.
 * Saves to localStorage + syncs to server async.
 */

import { apiFetch } from './csrf.js';

const THEMES = [
  { id: 'dark',     name: 'Dark',     colors: { bg: '#0f0f1a', primary: '#e94560', accent: '#45a29e', board: ['#eeeed2', '#769656'] } },
  { id: 'light',    name: 'Light',    colors: { bg: '#f8f6f1', primary: '#4f46e5', accent: '#0891b2', board: ['#f0d9b5', '#b58863'] } },
  { id: 'midnight', name: 'Midnight', colors: { bg: '#080818', primary: '#00d4ff', accent: '#00fa9a', board: ['#dee3e6', '#8ca2ad'] } },
  { id: 'emerald',  name: 'Emerald',  colors: { bg: '#0a1a0f', primary: '#50c878', accent: '#ffd700', board: ['#ffffdd', '#86a666'] } },
  { id: 'royal',    name: 'Royal',    colors: { bg: '#0e0618', primary: '#bb86fc', accent: '#e6c200', board: ['#f0e0ff', '#8e44ad'] } },
  { id: 'ocean',    name: 'Ocean',    colors: { bg: '#060e1a', primary: '#00b4d8', accent: '#48cae4', board: ['#d4e4f7', '#5b8fb9'] } },
  { id: 'rose',     name: 'Rose',     colors: { bg: '#140e12', primary: '#e91e8c', accent: '#f472b6', board: ['#f5e6f0', '#b05080'] } },
];

/**
 * Set the active theme.
 * @param {string} themeId
 * @param {boolean} sync - sync to server (default true)
 */
export function setTheme(themeId, sync = true) {
  if (!THEMES.find(t => t.id === themeId)) return;
  document.documentElement.setAttribute('data-theme', themeId);
  localStorage.setItem('chess-learn-theme', themeId);

  // Dispatch event for Chart.js re-render etc.
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: themeId } }));

  // Sync to server async (fire and forget)
  if (sync) {
    apiFetch('/api/auth/theme', {
      method: 'POST',
      body: { theme: themeId },
    }).catch(() => {});
  }
}

/**
 * Get the current active theme ID.
 */
export function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

/**
 * Get list of available themes with metadata.
 */
export function getAvailableThemes() {
  return THEMES;
}

/**
 * Initialize theme from localStorage or system preference.
 */
export function initTheme() {
  const saved = localStorage.getItem('chess-learn-theme');
  if (saved && THEMES.find(t => t.id === saved)) {
    document.documentElement.setAttribute('data-theme', saved);
    return;
  }
  // Detect system preference
  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}
