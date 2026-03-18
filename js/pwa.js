/**
 * PWA installation module — handles beforeinstallprompt + iOS detection.
 */

import { t } from './i18n.js';

let deferredPrompt = null;
let isIOS = false;

// Detect iOS Safari (not in standalone mode)
if (typeof navigator !== 'undefined') {
  isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone;
}

// Listen for the beforeinstallprompt event (Chrome/Edge/Samsung)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show existing button or create it if sidebar is already rendered
  const btn = document.getElementById('nav-install-btn');
  if (btn) {
    btn.style.display = '';
  } else {
    renderInstallButton();
  }
});

// Hide button once installed
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const btn = document.getElementById('nav-install-btn');
  if (btn) btn.style.display = 'none';
});

/**
 * Returns true if the app is already running in standalone/installed mode.
 */
function isAlreadyInstalled() {
  if (window.navigator.standalone) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

/**
 * Returns true if the app can be installed (either via prompt or iOS instructions).
 */
export function canInstallPWA() {
  if (isAlreadyInstalled()) return false;
  if (deferredPrompt) return true;
  if (isIOS) return true;
  return false;
}

/**
 * Trigger the install prompt or show iOS instructions.
 */
export async function promptInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      deferredPrompt = null;
    }
    return;
  }

  if (isIOS) {
    // Show a toast with iOS-specific instructions
    showIOSInstallToast();
  }
}

function showIOSInstallToast() {
  // Remove any existing toast
  const existing = document.getElementById('pwa-ios-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'pwa-ios-toast';
  toast.className = 'pwa-ios-toast';
  toast.innerHTML = `
    <div class="pwa-ios-toast-content">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
        <polyline points="16 6 12 2 8 6"/>
        <line x1="12" y1="2" x2="12" y2="15"/>
      </svg>
      <span>${t('pwa.iosInstructions')}</span>
      <button class="pwa-ios-toast-close">&times;</button>
    </div>
  `;
  document.body.appendChild(toast);

  toast.querySelector('.pwa-ios-toast-close')?.addEventListener('click', () => toast.remove());
  setTimeout(() => toast.remove(), 8000);
}

/**
 * Render the install button at the bottom of the sidebar menu (after last item).
 */
export function renderInstallButton() {
  if (!canInstallPWA()) return;

  // Don't add if already present
  if (document.getElementById('nav-install-btn')) return;

  const menu = document.querySelector('#main-sidebar .menu');
  if (!menu) return;

  const li = document.createElement('li');
  li.id = 'nav-install-btn';
  li.className = 'pwa-install-item';
  li.innerHTML = `
    <a href="#" class="pwa-install-link">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>${t('nav.install')}</span>
    </a>
  `;

  li.querySelector('a').addEventListener('click', (e) => {
    e.preventDefault();
    promptInstall();
  });

  // Always append at the end of the menu
  menu.appendChild(li);

  // Chrome: hide if no deferredPrompt yet (will be shown by the event)
  if (!deferredPrompt && !isIOS) {
    li.style.display = 'none';
  }
}
