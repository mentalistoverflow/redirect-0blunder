/**
 * Layout manager — DaisyUI drawer (sidebar) + content zone + optional right panel.
 * Exports: initLayout(), setRightPanel(), hideRightPanel()
 */

import { t } from '../i18n.js';
import { renderSidebar, updateSidebarActive } from './sidebar.js';
import { getUser, isFreeUser } from '../user-state.js';
import { apiFetch } from '../csrf.js';
import { initAIWidget, destroyAIWidget } from '../ai-widget.js';
import { renderInstallButton } from '../pwa.js';

let _initialized = false;

/**
 * Initialize the main layout structure in the DOM.
 * Must be called once on app startup (after auth check).
 */
export function initLayout({ isAdmin = false, user = null, onLogout } = {}) {
  const body = document.body;

  // Remove old nav-bar if present (legacy)
  const oldNav = body.querySelector('.nav-bar');
  if (oldNav) oldNav.remove();

  // Remove old app container
  const oldApp = document.getElementById('app');
  if (oldApp) oldApp.remove();

  // Build the drawer layout
  const drawer = document.createElement('div');
  drawer.className = 'drawer lg:drawer-open';
  drawer.id = 'main-drawer';
  drawer.innerHTML = `
    <input id="drawer-toggle" type="checkbox" class="drawer-toggle" />

    <div class="drawer-content flex flex-col">
      <!-- Mobile-only top bar (hamburger) -->
      <nav class="navbar bg-base-200 sticky top-0 z-30 lg:hidden" id="main-navbar" aria-label="${t('nav.topBar')}">
        <div class="flex-none">
          <label for="drawer-toggle" class="btn btn-square btn-ghost drawer-button" aria-label="${t('nav.toggleSidebar')}">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </label>
        </div>
        <div class="flex-1">
          <span class="text-lg font-bold">${formatBrandName(document.title || 'Chess Learn')}</span>
        </div>
      </nav>

      <!-- Global challenge notifications -->
      <div id="global-challenges" aria-live="polite"></div>

      <!-- Main content area -->
      <div class="layout-body">
        <main id="app" class="main-content" role="main" aria-label="${t('nav.mainContent')}"></main>
        <aside id="right-panel" class="right-panel hidden" aria-label="${t('nav.rightPanel')}"></aside>
      </div>
    </div>

    <!-- Sidebar -->
    <div class="drawer-side z-40">
      <label for="drawer-toggle" aria-label="close sidebar" class="drawer-overlay"></label>
      <aside id="main-sidebar" class="bg-base-200 min-h-full w-64 p-4 glass-sidebar" role="navigation" aria-label="${t('nav.sidebar')}"></aside>
    </div>
  `;

  // Insert into body (before scripts)
  const firstScript = body.querySelector('script');
  if (firstScript) {
    body.insertBefore(drawer, firstScript);
  } else {
    body.appendChild(drawer);
  }

  // Render sidebar content (with user info at bottom)
  const sidebarEl = document.getElementById('main-sidebar');
  if (sidebarEl) {
    renderSidebar(sidebarEl, { isAdmin, currentRoute: 'live', user, onLogout });
  }

  // PWA install button in sidebar (if installable)
  renderInstallButton();

  // Initialize AI widget (floating chat) — premium only
  if (!isFreeUser()) {
    initAIWidget();
  }

  _initialized = true;
}

/**
 * Check if layout has been initialized.
 */
export function isLayoutInitialized() {
  return _initialized;
}

/**
 * Tear down layout (for auth page — show no sidebar).
 */
export function destroyLayout() {
  destroyAIWidget();
  const drawer = document.getElementById('main-drawer');
  if (drawer) drawer.remove();
  _initialized = false;
}

/**
 * Get the main content container element.
 */
export function getContentContainer() {
  return document.getElementById('app');
}

/**
 * Set content in the right panel.
 * @param {string|HTMLElement} content - HTML string or element
 */
export function setRightPanel(content) {
  const panel = document.getElementById('right-panel');
  if (!panel) return;
  if (typeof content === 'string') {
    panel.innerHTML = content;
  } else {
    panel.innerHTML = '';
    panel.appendChild(content);
  }
  panel.classList.remove('hidden');
}

/**
 * Hide the right panel.
 */
export function hideRightPanel() {
  const panel = document.getElementById('right-panel');
  if (panel) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
  }
}

/**
 * Update the active route in the sidebar.
 */
export function setActiveRoute(route) {
  updateSidebarActive(route);
}

/**
 * Update the connection status indicator (in sidebar).
 */
export function setConnectionStatus(connected) {
  const dot = document.getElementById('status-dot');
  if (dot) {
    dot.classList.toggle('connected', connected);
    dot.classList.toggle('disconnected', !connected);
  }
}

/**
 * Update navbar user info (e.g., after language change).
 */
export function updateNavbar(user) {
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.title = t('nav.logout');
  }
}

/** Escape HTML entities to prevent XSS in innerHTML templates. */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Format brand name — wrap zeros in slashed-zero spans. */
function formatBrandName(name) {
  return escapeHtml(name).replace(/0/g, '<span class="slashed-zero">0</span>');
}
