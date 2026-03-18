/**
 * Main SPA router — hash-based navigation with DaisyUI drawer layout.
 */

import { wsClient } from './websocket.js';
import { initI18n, t, getLang, setLang, getLocale } from './i18n.js';
import * as live from './live.js';
import * as review from './review.js';
import * as dashboard from './dashboard.js';
import * as training from './training.js';
import * as settings from './settings.js';
import * as auth from './auth.js';
import * as admin from './admin.js';
import * as subscription from './subscription.js';
import * as pricing from './pages/pricing.js';
import * as friend from './friend.js';
import { renderInstallButton } from './pwa.js';
import { apiFetch } from './csrf.js';
import { setUser, isFreeUser, getUser } from './user-state.js';
import {
  initLayout, destroyLayout, isLayoutInitialized,
  getContentContainer, setActiveRoute, setConnectionStatus, hideRightPanel,
} from './components/layout.js';
import { renderSidebar } from './components/sidebar.js';

const pages = { live, review, dashboard, training, settings, auth, admin, subscription, pricing };
let currentPage = null;
let currentDestroy = null;
let currentUser = null;

// Games list page (inline — no separate module)
const GAMES_PER_PAGE = 30;
let gamesCurrentPage = 0;
let gamesTotalPages = 0;
let gamesOpeningsList = [];
let gamesPreviewGround = null;

const gamesPage = {
  async render(container) {
    gamesCurrentPage = 0;
    gamesTotalPages = 0;
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">${t('games.title')}</h3>
          <span class="text-muted" id="games-count"></span>
        </div>
        <div class="card-body">
          <div class="mb-4" id="games-filters">
            <div class="flex flex-wrap gap-2 items-center">
              <input type="text" class="input input-bordered input-sm w-40" id="filter-opponent" placeholder="${t('games.filterOpponent')}">
              <select class="select select-bordered" id="filter-opening" style="min-width:16rem;max-width:24rem">
                <option value="">${t('games.allOpenings')}</option>
              </select>
              <button class="btn btn-ghost btn-sm" id="filter-clear">${t('games.filterClear')}</button>
            </div>
            <div class="flex flex-wrap gap-2 items-center mt-2">
              <span class="text-sm opacity-60">${t('games.filterDateFrom')}</span>
              <input type="date" class="input input-bordered input-sm" id="filter-date-from">
              <span class="text-sm opacity-60">${t('games.filterDateTo')}</span>
              <input type="date" class="input input-bordered input-sm" id="filter-date-to">
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="table table-sm" id="games-table">
              <thead>
                <tr>
                  <th>${t('games.opponent')}</th>
                  <th>${t('games.result')}</th>
                  <th>${t('games.accuracy')}</th>
                  <th>${t('games.opening')}</th>
                  <th>${t('games.date')}</th>
                  <th>${t('games.bestMoves')}</th>
                  <th>${t('games.blunders')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody><tr><td colspan="8"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
          <div class="flex justify-center gap-1 mt-4" id="games-pagination"></div>
        </div>
      </div>
      <div class="opening-preview" id="opening-preview"><div class="cg-wrap" id="opening-preview-board"></div></div>
    `;

    loadOpeningsDropdown();

    let filterTimer = null;
    const applyFilters = () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => loadGamesPage(0), 300);
    };
    document.getElementById('filter-opponent')?.addEventListener('input', applyFilters);
    document.getElementById('filter-opening')?.addEventListener('change', () => loadGamesPage(0));
    document.getElementById('filter-date-from')?.addEventListener('change', () => loadGamesPage(0));
    document.getElementById('filter-date-to')?.addEventListener('change', () => loadGamesPage(0));
    document.getElementById('filter-clear')?.addEventListener('click', () => {
      const oppEl = document.getElementById('filter-opponent');
      const openEl = document.getElementById('filter-opening');
      const dfEl = document.getElementById('filter-date-from');
      const dtEl = document.getElementById('filter-date-to');
      if (oppEl) oppEl.value = '';
      if (openEl) openEl.value = '';
      if (dfEl) dfEl.value = '';
      if (dtEl) dtEl.value = '';
      loadGamesPage(0);
    });

    await loadGamesPage(0);
  },
  destroy() {
    if (gamesPreviewGround) { gamesPreviewGround.destroy(); gamesPreviewGround = null; }
  },
};

function getGamesFilters() {
  return {
    opponent: document.getElementById('filter-opponent')?.value.trim() || '',
    opening: document.getElementById('filter-opening')?.value || '',
    date_from: document.getElementById('filter-date-from')?.value || '',
    date_to: document.getElementById('filter-date-to')?.value || '',
  };
}

function buildFilterQuery(filters) {
  const params = new URLSearchParams();
  if (filters.opponent) params.set('opponent', filters.opponent);
  if (filters.opening) params.set('opening', filters.opening);
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  return params.toString();
}

async function loadOpeningsDropdown() {
  try {
    const resp = await fetch('/api/games/openings');
    if (!resp.ok) return;
    gamesOpeningsList = await resp.json();
    const select = document.getElementById('filter-opening');
    if (!select) return;
    for (const o of gamesOpeningsList) {
      const opt = document.createElement('option');
      opt.value = o.name;
      opt.textContent = `${o.name}${o.eco ? ' (' + o.eco + ')' : ''} — ${o.count}`;
      select.appendChild(opt);
    }
  } catch {}
}

async function loadGamesPage(page) {
  const offset = page * GAMES_PER_PAGE;
  const tbody = document.querySelector('#games-table tbody');
  if (!tbody) return;

  const filters = getGamesFilters();
  const filterQuery = buildFilterQuery(filters);
  const filterSuffix = filterQuery ? '&' + filterQuery : '';

  try {
    const [resp, countResp] = await Promise.all([
      fetch(`/api/games?limit=${GAMES_PER_PAGE}&offset=${offset}${filterSuffix}`),
      fetch(`/api/games/count?${filterQuery}`),
    ]);
    if (resp.status === 401) { showAuthPage(); return; }
    const games = await resp.json();

    const totalGames = countResp.ok ? (await countResp.json()).count : 0;
    gamesTotalPages = Math.ceil(totalGames / GAMES_PER_PAGE);

    const countEl = document.getElementById('games-count');
    if (countEl) countEl.textContent = t('games.count', { n: totalGames });

    if (!games.length) {
      const msg = filterQuery ? t('games.noResults') : t('games.noGames');
      tbody.innerHTML = `<tr><td colspan="8" class="text-muted">${msg}</td></tr>`;
      const pagDiv = document.getElementById('games-pagination');
      if (pagDiv) pagDiv.innerHTML = '';
      return;
    }

    const showCheater = getUser()?.show_cheater_flag;

    tbody.innerHTML = games.map(g => {
      const dateStr = formatPlayedAt(g.played_at);
      const hasAnalysis = g.accuracy_pct != null;
      const accuracyCell = hasAnalysis
        ? `${g.accuracy_pct}%`
        : (isFreeUser()
          ? `<span class="pill pill-warning pill-xs">${t('upsell.premiumBadge')}</span>`
          : `<span class="pill pill-ghost pill-xs">${t('games.pendingAnalysis')}</span>`);
      const actionLabel = hasAnalysis ? t('games.review') : t('games.analyse');
      const openingFen = g.opening_fen || '';

      let resultLabel = '?', resultClass = '';
      const r = g.result || '';
      const isWhite = g.our_color === 'w';
      if (r === '1-0') {
        resultLabel = isWhite ? t('games.win') : t('games.loss');
        resultClass = isWhite ? 'text-success' : 'text-error';
      } else if (r === '0-1') {
        resultLabel = isWhite ? t('games.loss') : t('games.win');
        resultClass = isWhite ? 'text-error' : 'text-success';
      } else if (r === '1/2-1/2') {
        resultLabel = t('games.draw');
        resultClass = 'opacity-70';
      }

      const bestCount = (g.brilliant_count || 0) + (g.great_count || 0);

      const isCheater = showCheater && g.opponent_tos;
      const cheaterCls = isCheater ? ' cheater-flag' : '';
      const cheaterTooltip = isCheater ? ` data-cheater-tooltip="${t('live.cheaterFlag').replace(/"/g, '&quot;')}"` : '';

      const openingMovesAttr = g.opening_moves?.length ? ` data-opening-moves="${g.opening_moves.join(',')}"` : '';

      return `
      <tr class="hover">
        <td><span class="${cheaterCls}"${cheaterTooltip}>${escapeHtml(g.opponent) || '?'}</span></td>
        <td><span class="${resultClass} font-medium">${resultLabel}</span></td>
        <td>${accuracyCell}</td>
        <td class="opening-cell" ${openingFen ? `data-fen="${escapeHtml(openingFen)}"` : ''}${openingMovesAttr}>${escapeHtml(g.opening_name) || '&#x2014;'}</td>
        <td class="text-muted text-sm">${dateStr}</td>
        <td>
          ${g.brilliant_count ? `<span class="move-dot dot-brilliant" title="${t('chart.brilliant')}">${g.brilliant_count}</span>` : ''}
          ${g.great_count ? `<span class="move-dot dot-great" title="${t('chart.excellent')}">${g.great_count}</span>` : ''}
          ${!bestCount && hasAnalysis ? '<span class="text-muted">—</span>' : ''}
        </td>
        <td>
          ${g.blunder_count ? `<span class="move-dot dot-blunder" title="${t('chart.blunder')}">${g.blunder_count}</span>` : ''}
          ${g.mistake_count ? `<span class="move-dot dot-mistake" title="${t('chart.mistake')}">${g.mistake_count}</span>` : ''}
          ${g.inaccuracy_count ? `<span class="move-dot dot-inaccuracy" title="${t('chart.inaccuracy')}">${g.inaccuracy_count}</span>` : ''}
        </td>
        <td><a href="#review/${g.id}" class="btn btn-primary btn-xs">${actionLabel}</a></td>
      </tr>
    `}).join('');

    attachOpeningHover();
    renderGamesPagination(page, gamesTotalPages);
    gamesCurrentPage = page;

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-error">${t('games.loadError')}</td></tr>`;
  }
}

function renderGamesPagination(page, totalPages) {
  const pagDiv = document.getElementById('games-pagination');
  if (!pagDiv) return;
  if (totalPages <= 1) { pagDiv.innerHTML = ''; return; }

  let html = '';
  html += `<button class="btn btn-ghost btn-xs" ${page === 0 ? 'disabled' : ''} data-page="0">&#8676;</button>`;
  html += `<button class="btn btn-ghost btn-xs" ${page === 0 ? 'disabled' : ''} data-page="${page - 1}">&laquo;</button>`;
  const start = Math.max(0, page - 3);
  const end = Math.min(totalPages, page + 4);
  for (let i = start; i < end; i++) {
    html += `<button class="btn btn-xs ${i === page ? 'btn-primary' : 'btn-ghost'}" data-page="${i}">${i + 1}</button>`;
  }
  html += `<button class="btn btn-ghost btn-xs" ${page >= totalPages - 1 ? 'disabled' : ''} data-page="${page + 1}">&raquo;</button>`;
  html += `<button class="btn btn-ghost btn-xs" ${page >= totalPages - 1 ? 'disabled' : ''} data-page="${totalPages - 1}">&#8677;</button>`;
  html += `<span class="text-sm opacity-60 ml-2">${t('games.page')} <input type="number" class="input input-bordered input-xs w-14" min="1" max="${totalPages}" value="${page + 1}" id="page-jump-input"> ${t('games.of')} ${totalPages}</span>`;

  pagDiv.innerHTML = html;

  pagDiv.querySelectorAll('.btn:not([disabled])').forEach(btn => {
    if (btn.dataset.page !== undefined) {
      btn.addEventListener('click', () => loadGamesPage(parseInt(btn.dataset.page)));
    }
  });

  const jumpInput = document.getElementById('page-jump-input');
  if (jumpInput) {
    jumpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = parseInt(jumpInput.value);
        if (!isNaN(val) && val >= 1 && val <= totalPages) {
          loadGamesPage(val - 1);
        }
      }
    });
  }
}

let _openingAnimId = 0; // incremented to cancel stale animations
let _chessgroundModule = null;

function attachOpeningHover() {
  const previewEl = document.getElementById('opening-preview');
  if (!previewEl) return;

  document.querySelectorAll('.opening-cell[data-fen]').forEach(cell => {
    cell.addEventListener('mouseenter', async () => {
      const fen = cell.dataset.fen;
      if (!fen) return;

      // Cancel any previous animation
      const animId = ++_openingAnimId;

      const rect = cell.getBoundingClientRect();
      previewEl.style.left = rect.left + 'px';
      previewEl.style.top = (rect.bottom + 4) + 'px';

      const boardEl = document.getElementById('opening-preview-board');
      if (!boardEl) return;

      // Lazy-load Chessground
      if (!_chessgroundModule) {
        _chessgroundModule = await import('/static/vendor/chessground.min.js');
      }
      if (animId !== _openingAnimId) return; // cancelled during import
      const { Chessground } = _chessgroundModule;

      // Parse opening moves
      const movesRaw = cell.dataset.openingMoves;
      const moves = movesRaw ? movesRaw.split(',') : [];

      const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

      // Init or reset board to starting position
      if (gamesPreviewGround) {
        gamesPreviewGround.set({ fen: startFen, viewOnly: true, lastMove: undefined });
      } else {
        gamesPreviewGround = Chessground(boardEl, {
          fen: startFen, viewOnly: true, coordinates: false,
          animation: { enabled: true, duration: 300 },
        });
      }

      previewEl.classList.add('visible');

      // Animate opening moves one by one using chained setTimeout
      if (moves.length > 0 && window.Chess) {
        const chess = new Chess();
        for (let i = 0; i < moves.length; i++) {
          // Wait 800ms before each move
          await new Promise(resolve => setTimeout(resolve, 300));
          if (animId !== _openingAnimId) return; // cancelled
          const uci = moves[i];
          const from = uci.slice(0, 2);
          const to = uci.slice(2, 4);
          const promo = uci.length > 4 ? uci[4] : undefined;
          const result = chess.move({ from, to, promotion: promo });
          if (result) {
            gamesPreviewGround.set({
              fen: chess.fen(),
              lastMove: [from, to],
            });
          }
        }
      } else if (fen) {
        // Fallback: just show final opening position
        gamesPreviewGround.set({ fen, viewOnly: true, lastMove: undefined });
      }
    });

    cell.addEventListener('mouseleave', () => {
      _openingAnimId++; // cancel any running animation
      previewEl.classList.remove('visible');
    });
  });
}

function formatPlayedAt(played_at) {
  if (!played_at) return '—';
  try {
    const locale = getLocale();
    const d = new Date(played_at);
    if (isNaN(d.getTime())) {
      const ts = parseInt(played_at);
      if (!isNaN(ts)) {
        const d2 = new Date(ts);
        return d2.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
          + ' ' + d2.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      }
      return '—';
    }
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

// Make formatPlayedAt available globally for other modules
window.formatPlayedAt = formatPlayedAt;

function getRoute() {
  const hash = location.hash.slice(1) || 'live';
  const parts = hash.split('/');
  return { page: parts[0], param: parts[1] || null };
}

async function checkAuth() {
  try {
    const resp = await fetch('/api/auth/me');
    if (resp.ok) {
      currentUser = await resp.json();
      setUser(currentUser);
      return true;
    }
  } catch {}
  currentUser = null;
  setUser(null);
  return false;
}

function showAuthPage() {
  location.hash = '#auth';
}

async function handleLogout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  currentUser = null;
  setUser(null);
  destroyLayout();
  window.location.hash = '#auth';
  window.location.reload();
}

/**
 * Ensure the drawer layout is active (for logged-in pages).
 */
function ensureLayout() {
  if (isLayoutInitialized()) return;
  initLayout({
    isAdmin: currentUser?.is_admin,
    user: currentUser,
    onLogout: handleLogout,
  });
}

/**
 * Show auth page (no sidebar, full-screen).
 */
function showAuthLayout() {
  if (isLayoutInitialized()) {
    destroyLayout();
  }
  // Create a simple auth container
  let container = document.getElementById('app');
  if (!container) {
    container = document.createElement('div');
    container.id = 'app';
    container.className = 'auth-container';
    document.body.insertBefore(container, document.body.querySelector('script'));
  }
  container.className = 'auth-container';
  return container;
}

async function navigate() {
  const { page, param } = getRoute();

  // Auth page: no sidebar layout
  if (page === 'auth') {
    const isLoggedIn = await checkAuth();
    if (isLoggedIn) {
      location.hash = '#live';
      return;
    }
    // Destroy current page
    if (currentDestroy) {
      try { currentDestroy(); } catch {}
      currentDestroy = null;
    }
    const container = showAuthLayout();
    container.innerHTML = '';
    try {
      await auth.render(container);
      currentDestroy = auth.destroy;
      currentPage = 'auth';
    } catch (e) {
      console.error('Auth page error:', e);
    }
    return;
  }

  // All other pages: require auth + sidebar layout
  if (!currentUser) {
    const isLoggedIn = await checkAuth();
    if (!isLoggedIn) {
      location.hash = '#auth';
      return;
    }
  }

  // Ensure layout is initialized
  ensureLayout();

  // Get content container
  const container = getContentContainer();
  if (!container) return;

  // Destroy current page
  if (currentDestroy) {
    try { currentDestroy(); } catch {}
    currentDestroy = null;
  }

  // Hide right panel by default (pages can re-show it)
  hideRightPanel();

  // Clear container
  container.innerHTML = '';

  // Update sidebar active state
  setActiveRoute(page);

  // Re-render global challenges (hidden on /#live, shown elsewhere)
  renderGlobalChallenges();

  // Redirect subscription → pricing
  if (page === 'subscription') {
    location.hash = '#pricing';
    return;
  }

  // Determine which module to render
  let mod = null;
  if (page === 'admin') {
    if (!currentUser || !currentUser.is_admin) {
      location.hash = '#live';
      return;
    }
    mod = pages.admin;
  } else if (page === 'games') {
    mod = gamesPage;
  } else if (page === 'review' && param) {
    mod = pages.review;
  } else if (page === 'friend' && param) {
    mod = friend;
  } else if (pages[page]) {
    mod = pages[page];
  } else {
    mod = pages.live;
  }

  try {
    if ((page === 'review' || page === 'friend') && param) {
      await mod.render(container, param);
    } else {
      await mod.render(container);
    }
    currentDestroy = mod.destroy || null;
    currentPage = page;
  } catch (e) {
    console.error(`Page render error (${page}):`, e);
    container.innerHTML = `<div class="card"><div class="card-body"><p class="text-error">${t('common.pageLoadError')}</p></div></div>`;
  }
}

// --- Init ---
window.addEventListener('hashchange', navigate);

// Language change listener
window.addEventListener('langchange', () => {
  // Re-render sidebar labels
  const sidebarEl = document.getElementById('main-sidebar');
  if (sidebarEl && currentUser) {
    renderSidebar(sidebarEl, {
      isAdmin: currentUser.is_admin,
      currentRoute: getRoute().page,
    });
    // Re-apply WebSocket connection status after sidebar re-render
    const wsConnected = wsClient.ws && wsClient.ws.readyState === WebSocket.OPEN;
    setConnectionStatus(wsConnected);
  }
  navigate();
});

document.addEventListener('DOMContentLoaded', async () => {
  // Register service worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }

  // Init i18n
  await initI18n();

  // Apply theme from localStorage
  const savedTheme = localStorage.getItem('chess-learn-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Check auth
  const isLoggedIn = await checkAuth();

  // Sync theme + language from server
  if (isLoggedIn && currentUser) {
    // Setup WebSocket (must run before any early return)
    wsClient.on('connected', () => setConnectionStatus(true));
    wsClient.on('disconnected', () => setConnectionStatus(false));
    wsClient.connect();

    // Global challenge notifications (visible on all pages)
    setupGlobalChallengeListeners();

    if (currentUser.theme && currentUser.theme !== savedTheme) {
      document.documentElement.setAttribute('data-theme', currentUser.theme);
      localStorage.setItem('chess-learn-theme', currentUser.theme);
    }
    if (currentUser.language) {
      const savedLang = localStorage.getItem('chess-learn-lang') || 'fr';
      if (currentUser.language !== savedLang) {
        localStorage.setItem('chess-learn-lang', currentUser.language);
        await setLang(currentUser.language);
        return; // setLang triggers langchange → navigate()
      }
    }
  }

  // PWA install button
  renderInstallButton();

  // Initial navigation
  navigate();
});

/** Escape HTML entities to prevent XSS in innerHTML templates. */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Global challenge notifications ─────────────────────────────
const globalChallenges = new Map();

function onGlobalChallengeIncoming(data) {
  data._direction = 'received';
  globalChallenges.set(data.id, data);
  renderGlobalChallenges();
}
function onGlobalChallengeSent(data) {
  data._direction = 'sent';
  globalChallenges.set(data.id, data);
  renderGlobalChallenges();
}
function onGlobalChallengeCanceled(data) {
  globalChallenges.delete(data.id);
  renderGlobalChallenges();
}
function onGlobalChallengeDeclined(data) {
  globalChallenges.delete(data.id);
  renderGlobalChallenges();
}
function onGlobalGameStart() {
  globalChallenges.clear();
  renderGlobalChallenges();
}

function renderGlobalChallenges() {
  // On /#live page, live.js handles its own challenge rendering — hide global
  if (getRoute().page === 'live') {
    const gc = document.getElementById('global-challenges');
    if (gc) gc.innerHTML = '';
    return;
  }
  const container = document.getElementById('global-challenges');
  if (!container) return;
  if (globalChallenges.size === 0) { container.innerHTML = ''; return; }

  let html = '';
  for (const [id, ch] of globalChallenges) {
    if (ch._direction === 'sent') {
      const rated = ch.rated ? t('live.rated') : t('live.casual');
      html += `
        <div class="alert alert-info shadow-lg mb-2 text-info-content global-challenge-item" data-id="${escapeHtml(id)}">
          <span class="flex-1">${escapeHtml(t('live.challengeSentWaiting', { opponent: ch.opponent || '?', timeControl: ch.time_control || '?', rated }))}</span>
          <button class="btn btn-warning btn-sm global-ch-cancel" data-id="${escapeHtml(id)}">${t('live.cancelChallenge')}</button>
        </div>`;
    } else {
      const rated = ch.rated ? t('live.rated') : t('live.casual');
      html += `
        <div class="alert alert-warning shadow-lg mb-2 text-warning-content global-challenge-item" data-id="${escapeHtml(id)}">
          <span class="flex-1">${escapeHtml(t('live.challengeIncoming', { challenger: ch.challenger || '?', rating: ch.rating || '?', timeControl: ch.time_control || '?', rated }))}</span>
          <div class="flex gap-2">
            <button class="btn btn-success btn-sm global-ch-accept" data-id="${escapeHtml(id)}">${t('live.accept')}</button>
            <button class="btn btn-ghost btn-sm global-ch-decline" data-id="${escapeHtml(id)}">${t('live.decline')}</button>
          </div>
        </div>`;
    }
  }
  container.innerHTML = html;

  container.querySelectorAll('.global-ch-accept').forEach(btn => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/api/live/challenge/${btn.dataset.id}/accept`, { method: 'POST' });
      globalChallenges.delete(btn.dataset.id);
      renderGlobalChallenges();
      location.hash = '#live';
    });
  });
  container.querySelectorAll('.global-ch-decline').forEach(btn => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/api/live/challenge/${btn.dataset.id}/decline`, { method: 'POST' });
      globalChallenges.delete(btn.dataset.id);
      renderGlobalChallenges();
    });
  });
  container.querySelectorAll('.global-ch-cancel').forEach(btn => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/api/live/challenge/${btn.dataset.id}/cancel`, { method: 'POST' });
      globalChallenges.delete(btn.dataset.id);
      renderGlobalChallenges();
    });
  });
}

async function loadGlobalChallenges() {
  try {
    const resp = await apiFetch('/api/live/challenges');
    if (resp.ok) {
      const data = await resp.json();
      for (const ch of (data.challenges || [])) {
        ch._direction = ch.type === 'challenge_sent' ? 'sent' : 'received';
        globalChallenges.set(ch.id, ch);
      }
      renderGlobalChallenges();
    }
  } catch { /* ignore */ }
}

function setupGlobalChallengeListeners() {
  wsClient.on('challenge_incoming', onGlobalChallengeIncoming);
  wsClient.on('challenge_sent', onGlobalChallengeSent);
  wsClient.on('challenge_canceled', onGlobalChallengeCanceled);
  wsClient.on('challenge_declined', onGlobalChallengeDeclined);
  wsClient.on('game_start', onGlobalGameStart);
  loadGlobalChallenges();
}
