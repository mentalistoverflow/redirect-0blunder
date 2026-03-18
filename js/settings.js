/**
 * Settings page — account, appearance (theme cards + piece sets), language, Lichess token.
 * Uses DaisyUI components: card, btn, input, badge, toggle.
 */

import { t, getLang, setLang, getLocale, getAvailableLanguages } from './i18n.js';
import { apiFetch } from './csrf.js';
import { setTheme, getCurrentTheme, getAvailableThemes } from './theme.js';
import { isSoundsEnabled, setSoundsEnabled } from './sounds.js';

export async function render(container) {
  const langs = getAvailableLanguages();
  const currentLang = getLang();
  const themes = getAvailableThemes();
  const currentThemeId = getCurrentTheme();

  container.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Account -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title text-base">${t('settings.account')}</h3>
          <div id="account-info"><span class="loading loading-spinner loading-sm"></span></div>
        </div>
      </div>

      <!-- Subscription Status -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title text-base">${t('subscription.title')}</h3>
          <div id="subscription-status"><span class="loading loading-spinner loading-sm"></span></div>
        </div>
      </div>

      <!-- Appearance: Themes -->
      <div class="card bg-base-200 lg:col-span-2">
        <div class="card-body">
          <h3 class="card-title text-base">${t('settings.appearance')}</h3>

          <label class="label"><span class="label-text font-medium">${t('settings.siteTheme')}</span></label>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3" id="theme-selector">
            ${themes.map(th => `
              <button class="theme-card ${th.id === currentThemeId ? 'theme-card-active' : ''}" data-theme-id="${th.id}" title="${th.name}">
                <div class="theme-card-preview" style="background: ${th.colors.bg};">
                  <svg viewBox="0 0 80 80" width="60" height="60">
                    <rect x="0" y="0" width="20" height="20" fill="${th.colors.board[0]}"/>
                    <rect x="20" y="0" width="20" height="20" fill="${th.colors.board[1]}"/>
                    <rect x="40" y="0" width="20" height="20" fill="${th.colors.board[0]}"/>
                    <rect x="60" y="0" width="20" height="20" fill="${th.colors.board[1]}"/>
                    <rect x="0" y="20" width="20" height="20" fill="${th.colors.board[1]}"/>
                    <rect x="20" y="20" width="20" height="20" fill="${th.colors.board[0]}"/>
                    <rect x="40" y="20" width="20" height="20" fill="${th.colors.board[1]}"/>
                    <rect x="60" y="20" width="20" height="20" fill="${th.colors.board[0]}"/>
                    <rect x="0" y="40" width="20" height="20" fill="${th.colors.board[0]}"/>
                    <rect x="20" y="40" width="20" height="20" fill="${th.colors.board[1]}"/>
                    <rect x="40" y="40" width="20" height="20" fill="${th.colors.board[0]}"/>
                    <rect x="60" y="40" width="20" height="20" fill="${th.colors.board[1]}"/>
                    <rect x="0" y="60" width="20" height="20" fill="${th.colors.board[1]}"/>
                    <rect x="20" y="60" width="20" height="20" fill="${th.colors.board[0]}"/>
                    <rect x="40" y="60" width="20" height="20" fill="${th.colors.board[1]}"/>
                    <rect x="60" y="60" width="20" height="20" fill="${th.colors.board[0]}"/>
                  </svg>
                  <div class="theme-card-colors">
                    <span style="background: ${th.colors.primary}"></span>
                    <span style="background: ${th.colors.accent}"></span>
                    <span style="background: ${th.colors.board[0]}"></span>
                    <span style="background: ${th.colors.board[1]}"></span>
                    <span style="background: ${th.colors.bg}"></span>
                  </div>
                </div>
                <span class="theme-card-name">${th.name}</span>
                ${th.id === currentThemeId ? `<span class="pill pill-primary pill-xs">${t('settings.active')}</span>` : ''}
              </button>
            `).join('')}
          </div>

          <!-- Language -->
          <label class="label mt-4"><span class="label-text font-medium">${t('settings.language')}</span></label>
          <div class="flex gap-2 flex-wrap" id="lang-selector">
            ${langs.map(l => `
              <button class="btn btn-sm ${l.code === currentLang ? 'btn-primary' : 'btn-ghost'}" data-lang="${l.code}">
                <span>${l.flag}</span>
                <span>${l.label}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Sounds -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title text-base">${t('settings.sounds')}</h3>
          <p class="text-sm opacity-60 mb-2">${t('settings.soundsDesc')}</p>
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <label class="switch"><input type="checkbox" id="sounds-toggle" ${isSoundsEnabled() ? 'checked' : ''} /><span class="switch-slider"></span></label>
              <span class="label-text">${t('settings.sounds')}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Lichess Connection -->
      <div class="card bg-base-200 lg:col-span-2">
        <div class="card-body">
          <h3 class="card-title text-base">${t('settings.lichess')}</h3>

          <div class="flex items-center gap-2 mb-3" id="lichess-status">
            <span class="loading loading-spinner loading-xs"></span>
            <span class="text-sm">${t('settings.verification')}</span>
          </div>

          <!-- Connected state -->
          <div id="lichess-connected" style="display:none">
            <div class="flex items-center gap-3 mb-3">
              <span class="text-sm opacity-60">${t('settings.lichessToken')}</span>
              <span class="font-mono text-sm opacity-40">&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;</span>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn btn-error btn-sm btn-outline" id="btn-disconnect-lichess">${t('settings.disconnectLichess')}</button>
              <span id="lichess-disconnect-status" class="text-sm"></span>
            </div>
          </div>

          <!-- Disconnected state -->
          <div id="lichess-disconnected" style="display:none">
            <div class="form-control mb-3">
              <label class="label"><span class="label-text">${t('settings.lichessToken')}</span></label>
              <input type="password" id="lichess-token" class="input input-bordered w-full max-w-md" placeholder="lip_..." />
              <label class="label">
                <span class="label-text-alt opacity-60">
                  ${t('settings.tokenHint')}
                  <a href="https://lichess.org/account/oauth/token" target="_blank" class="link link-primary">lichess.org</a>
                  ${t('settings.tokenScopes')}
                </span>
              </label>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn btn-primary btn-sm" id="btn-save-lichess">${t('settings.connectLichess')}</button>
              <span id="lichess-save-status" class="text-sm"></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Service Status -->
      <div class="card bg-base-200 lg:col-span-2">
        <div class="card-body">
          <h3 class="card-title text-base">${t('settings.serviceStatus')}</h3>
          <div id="detailed-status"><span class="loading loading-spinner loading-sm"></span></div>
        </div>
      </div>
    </div>
  `;

  // Load data
  await Promise.all([loadAccountInfo(), loadSettings(), checkStatus(), loadSubscriptionStatus()]);

  // Event handlers
  document.getElementById('btn-save-lichess')?.addEventListener('click', saveLichessToken);
  document.getElementById('btn-disconnect-lichess')?.addEventListener('click', disconnectLichess);

  // Theme cards
  document.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', () => {
      const themeId = card.dataset.themeId;
      setTheme(themeId);
      // Update UI
      document.querySelectorAll('.theme-card').forEach(c => {
        const isActive = c.dataset.themeId === themeId;
        c.classList.toggle('theme-card-active', isActive);
        const badge = c.querySelector('.pill');
        if (isActive && !badge) {
          c.insertAdjacentHTML('beforeend', `<span class="pill pill-primary pill-xs">${t('settings.active')}</span>`);
        } else if (!isActive && badge) {
          badge.remove();
        }
      });
    });
  });

  // Language buttons
  document.querySelectorAll('#lang-selector button').forEach(btn => {
    btn.addEventListener('click', () => changeLanguage(btn.dataset.lang));
  });

  // Sounds toggle
  document.getElementById('sounds-toggle')?.addEventListener('change', (e) => {
    setSoundsEnabled(e.target.checked);
  });
}

export function destroy() {}

async function changeLanguage(lang) {
  document.querySelectorAll('#lang-selector button').forEach(btn => {
    btn.className = `btn btn-sm ${btn.dataset.lang === lang ? 'btn-primary' : 'btn-ghost'}`;
  });
  try {
    await apiFetch('/api/auth/language', {
      method: 'POST',
      body: { language: lang },
    });
  } catch {}
  setLang(lang);
}

async function loadAccountInfo() {
  try {
    const resp = await fetch('/api/auth/me');
    if (!resp.ok) return;
    const user = await resp.json();
    const el = document.getElementById('account-info');
    if (el) {
      const locale = getLocale();
      el.innerHTML = `
        <div class="space-y-2 text-sm">
          <div class="flex justify-between"><span class="opacity-60">${t('settings.user')}</span><span class="font-medium">${escapeHtml(user.username)}</span></div>
          <div class="flex justify-between"><span class="opacity-60">${t('settings.lichessAccount')}</span><span>${user.lichess_username ? escapeHtml(user.lichess_username) : `<span class="opacity-40">${t('settings.notConnected')}</span>`}</span></div>
          <div class="flex justify-between"><span class="opacity-60">${t('settings.registeredAt')}</span><span class="opacity-70">${user.created_at ? new Date(user.created_at).toLocaleDateString(locale) : '—'}</span></div>
        </div>
        <div class="mt-4">
          <button class="btn btn-error btn-sm btn-outline" id="btn-logout-settings">${t('settings.logout')}</button>
        </div>
      `;
      document.getElementById('btn-logout-settings')?.addEventListener('click', async () => {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        window.location.hash = '#auth';
        window.location.reload();
      });
    }
  } catch {}
}

async function loadSettings() {
  try {
    const resp = await fetch('/api/settings');
    if (!resp.ok) return;
    const s = await resp.json();

    const statusEl = document.getElementById('lichess-status');
    const connectedEl = document.getElementById('lichess-connected');
    const disconnectedEl = document.getElementById('lichess-disconnected');

    if (s.lichess_ready) {
      if (statusEl) statusEl.innerHTML = `<span class="status-indicator connected"></span><span class="text-sm">${t('settings.connectedAs')} <strong>${s.lichess_username}</strong></span>`;
      if (connectedEl) connectedEl.style.display = '';
      if (disconnectedEl) disconnectedEl.style.display = 'none';
    } else {
      if (statusEl) statusEl.innerHTML = `<span class="status-indicator disconnected"></span><span class="text-sm">${t('settings.notConnected')}</span>`;
      if (connectedEl) connectedEl.style.display = 'none';
      if (disconnectedEl) disconnectedEl.style.display = '';
    }
  } catch {}
}

async function saveLichessToken() {
  const status = document.getElementById('lichess-save-status');
  const token = document.getElementById('lichess-token')?.value || '';
  if (!token) {
    if (status) { status.textContent = t('settings.enterToken'); status.className = 'text-sm text-error'; }
    return;
  }
  if (status) { status.textContent = t('settings.verification'); status.className = 'text-sm'; }
  try {
    const resp = await apiFetch('/api/auth/lichess-token', {
      method: 'POST',
      body: { lichess_token: token },
    });
    if (resp.ok) {
      const data = await resp.json();
      const statusBar = document.getElementById('lichess-status');
      if (statusBar) statusBar.innerHTML = `<span class="status-indicator connected"></span><span class="text-sm">${t('settings.connectedAs')} <strong>${data.lichess_username}</strong></span>`;
      const connectedEl = document.getElementById('lichess-connected');
      const disconnectedEl = document.getElementById('lichess-disconnected');
      if (connectedEl) connectedEl.style.display = '';
      if (disconnectedEl) disconnectedEl.style.display = 'none';
      document.getElementById('lichess-token').value = '';
      if (status) { status.textContent = t('settings.importInProgress') || 'Connecté ! Import des parties en cours...'; status.className = 'text-sm text-success'; }
      setTimeout(() => { if (status) status.textContent = ''; }, 8000);
    } else {
      const err = await resp.json().catch(() => ({}));
      if (status) { status.textContent = err.detail || t('settings.error'); status.className = 'text-sm text-error'; }
      setTimeout(() => { if (status) status.textContent = ''; }, 5000);
    }
  } catch {
    if (status) { status.textContent = t('settings.connectionError'); status.className = 'text-sm text-error'; }
    setTimeout(() => { if (status) status.textContent = ''; }, 5000);
  }
}

async function disconnectLichess() {
  const status = document.getElementById('lichess-disconnect-status');
  if (!confirm(t('settings.disconnectConfirm'))) return;
  if (status) status.textContent = t('settings.disconnecting');
  try {
    const resp = await apiFetch('/api/auth/lichess-token', {
      method: 'POST',
      body: { lichess_token: '' },
    });
    if (resp.ok) {
      const statusBar = document.getElementById('lichess-status');
      if (statusBar) statusBar.innerHTML = `<span class="status-indicator disconnected"></span><span class="text-sm">${t('settings.notConnected')}</span>`;
      const connectedEl = document.getElementById('lichess-connected');
      const disconnectedEl = document.getElementById('lichess-disconnected');
      if (connectedEl) connectedEl.style.display = 'none';
      if (disconnectedEl) disconnectedEl.style.display = '';
      if (status) status.textContent = '';
    } else {
      if (status) { status.textContent = t('settings.error'); status.className = 'text-sm text-error'; }
      setTimeout(() => { if (status) status.textContent = ''; }, 3000);
    }
  } catch {
    if (status) { status.textContent = t('settings.connectionError'); status.className = 'text-sm text-error'; }
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
  }
}

async function checkStatus() {
  const detailed = document.getElementById('detailed-status');
  if (!detailed) return;
  try {
    const resp = await fetch('/api/status');
    const s = await resp.json();
    detailed.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <span class="status-indicator ${s.stockfish ? 'connected' : 'disconnected'}"></span>
          <span class="text-sm">${t('settings.stockfish')} : ${s.stockfish ? t('settings.stockfishReady') : t('settings.stockfishNotFound')}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="status-indicator ${s.coach ? 'connected' : 'disconnected'}"></span>
          <span class="text-sm">${t('settings.coachIA')} : ${s.coach ? t('settings.coachAvailable') : t('settings.coachNotFound')}</span>
        </div>
      </div>
    `;
  } catch {
    detailed.innerHTML = `<span class="text-error text-sm">${t('settings.serviceCheckError')}</span>`;
  }
}

async function loadSubscriptionStatus() {
  const el = document.getElementById('subscription-status');
  if (!el) return;
  try {
    const resp = await fetch('/api/subscription/status');
    if (!resp.ok) {
      el.innerHTML = `
        <div class="space-y-2 text-sm">
          <div class="flex justify-between"><span class="opacity-60">${t('subscription.currentPlan')}</span><span class="font-medium">${t('subscription.freeTier')}</span></div>
        </div>
        <div class="mt-3"><a href="#subscription" class="btn btn-primary btn-sm">${t('subscription.upgrade')}</a></div>
      `;
      return;
    }
    const sub = await resp.json();
    const isActive = sub && sub.status === 'active';
    const tierName = sub ? sub.tier_name : t('subscription.freeTier');
    el.innerHTML = `
      <div class="space-y-2 text-sm">
        <div class="flex justify-between"><span class="opacity-60">${t('subscription.currentPlan')}</span><span class="font-medium">${tierName}</span></div>
        <div class="flex justify-between"><span class="opacity-60">${t('subscription.status')}</span><span>${isActive ? t('subscription.active') : t('subscription.none')}</span></div>
      </div>
      <div class="mt-3">
        ${isActive
          ? `<a href="#subscription" class="btn btn-ghost btn-sm">${t('subscription.manage')}</a>`
          : `<a href="#subscription" class="btn btn-primary btn-sm">${t('subscription.upgrade')}</a>`
        }
      </div>
    `;
  } catch {
    el.innerHTML = `<span class="text-sm opacity-60">${t('subscription.freeTier')}</span>`;
  }
}

/** Escape HTML entities to prevent XSS in innerHTML templates. */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
