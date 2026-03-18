/**
 * Sidebar component — DaisyUI drawer + menu navigation.
 * Sections: Jouer, Parties, Apprendre, Regarder.
 */

import { t } from '../i18n.js';

const NAV_ITEMS = [
  {
    section: null,
    items: [
      { route: 'live', icon: 'play', key: 'nav.live' },
      { route: 'games', icon: 'grid', key: 'nav.games' },
      { route: 'dashboard', icon: 'chart', key: 'nav.dashboard' },
    ],
  },
  {
    section: 'nav.sectionLearn',
    items: [
      { route: 'training', icon: 'puzzle', key: 'nav.training' },
    ],
  },
  {
    section: 'nav.sectionAccount',
    items: [
      { route: 'pricing', icon: 'star', key: 'nav.pricing' },
      { route: 'settings', icon: 'gear', key: 'nav.settings' },
      { route: 'admin', icon: 'lock', key: 'nav.admin', adminOnly: true },
    ],
  },
];

const ICONS = {
  play: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  grid: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>',
  chart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="13" width="4" height="8"/><rect x="10" y="8" width="4" height="13"/><rect x="17" y="3" width="4" height="18"/></svg>',
  puzzle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
  chat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  star: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  wallet: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"/></svg>',
  gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  lock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/></svg>',
};

/** Escape HTML entities to prevent XSS. */
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

/**
 * Render sidebar HTML into the given container.
 * @param {HTMLElement} container
 * @param {Object} options - { isAdmin, currentRoute, onNavigate, user, onLogout }
 */
export function renderSidebar(container, { isAdmin = false, currentRoute = 'live', onNavigate, user, onLogout } = {}) {
  const siteName = document.title || 'Chess Learn';
  const logoHtml = `<img id="sidebar-logo" src="/branding/logo" width="28" height="28" style="object-fit:contain" alt="" />`;
  let html = `
    <div class="sidebar-brand">
      ${logoHtml}
      <span class="sidebar-brand-text">${formatBrandName(siteName)}</span>
    </div>
    <nav class="flex-1" aria-label="${t('nav.sidebar')}">
    <ul class="menu menu-lg w-full" role="menubar">
  `;

  for (const group of NAV_ITEMS) {
    if (group.section) {
      html += `<li class="menu-title"><span>${t(group.section)}</span></li>`;
    }
    for (const item of group.items) {
      if (item.adminOnly && !isAdmin) continue;
      const isActive = currentRoute === item.route ||
        (item.route === 'games' && currentRoute === 'review');
      html += `
        <li role="none">
          <a class="${isActive ? 'active' : ''}" data-route="${item.route}" href="#${item.route}" role="menuitem"${isActive ? ' aria-current="page"' : ''}>
            ${ICONS[item.icon] || ''}
            <span>${t(item.key)}</span>
          </a>
        </li>
      `;
    }
  }

  html += '</ul></nav>';

  // User section at bottom
  if (user) {
    const lichessUser = escapeHtml(user.lichess_username || user.username);
    const profileUrl = user.lichess_username
      ? `https://lichess.org/@/${encodeURIComponent(user.lichess_username)}`
      : null;
    const CATEGORY_ICONS = { bullet: '\u26A1', blitz: '\uD83D\uDD25', rapid: '\uD83D\uDD50', classical: '\uD83C\uDFDB\uFE0F' };
    const CATEGORY_LABELS = { bullet: 'Bullet (\u22641+0)', blitz: 'Blitz (3+0 \u2013 5+3)', rapid: 'Rapide (10+0 \u2013 15+10)', classical: 'Classique (30+0+)' };
    let ratingsHtml = '';
    if (user.lichess_ratings) {
      const parts = Object.entries(user.lichess_ratings).map(
        ([cat, r]) => `<span class="tooltip tooltip-top" data-tip="${CATEGORY_LABELS[cat] || cat}">${CATEGORY_ICONS[cat] || ''} ${r}</span>`
      );
      ratingsHtml = `<div class="sidebar-user-ratings">${parts.join(' ')}</div>`;
    }
    const nameHtml = profileUrl
      ? `<a href="${profileUrl}" target="_blank" rel="noopener" class="sidebar-user-link">${lichessUser}</a>`
      : `<span>${lichessUser}</span>`;
    html += `
      <div class="sidebar-user">
        <div class="flex items-center gap-2">
          <span class="status-indicator disconnected" id="status-dot"></span>
          <span class="font-medium text-sm truncate flex-1">${nameHtml}</span>
          <button class="btn btn-ghost btn-sm btn-square" id="btn-logout" title="${t('nav.logout')}" aria-label="${t('nav.logout')}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
        ${ratingsHtml}
      </div>
    `;
  }

  container.innerHTML = html;

  // Logo fallback (no inline onerror — CSP blocks it)
  const logoImg = container.querySelector('#sidebar-logo');
  if (logoImg) {
    logoImg.addEventListener('error', () => {
      logoImg.outerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 22H5v-2h14v2M17.16 8.26A4.96 4.96 0 0 0 19 4.59V4h-2v.59c0 1.19-.52 2.27-1.35 3L14 8.87l-.52-.87c-.78-1.29-1.97-2.15-3.3-2.76A4.001 4.001 0 0 0 6 2H4v2.17c0 .92.31 1.77.85 2.43L7 9.43V12H5v2h2v2H5v2h14v-2h-2v-2h2v-2h-2V9.42l2.16-1.16Z"/></svg>';
    });
  }

  // Click handlers
  container.querySelectorAll('a[data-route]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const route = link.dataset.route;
      const currentHash = location.hash.slice(1).split('/')[0] || 'live';
      // Close mobile drawer
      const toggle = document.getElementById('drawer-toggle');
      if (toggle) toggle.checked = false;
      if (currentHash === route) {
        // Same page: notify the current page to reset (e.g. live → back to lobby)
        window.dispatchEvent(new CustomEvent('route-reclick', { detail: { route } }));
      } else {
        location.hash = '#' + route;
      }
      if (onNavigate) onNavigate(route);
    });
  });

  // Logout handler
  if (onLogout) {
    container.querySelector('#btn-logout')?.addEventListener('click', onLogout);
  }
}

/**
 * Update the active state of sidebar links.
 */
export function updateSidebarActive(route) {
  const sidebar = document.getElementById('main-sidebar');
  if (!sidebar) return;
  sidebar.querySelectorAll('a[data-route]').forEach(link => {
    const isActive = link.dataset.route === route ||
      (link.dataset.route === 'games' && route === 'review');
    link.classList.toggle('active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}
