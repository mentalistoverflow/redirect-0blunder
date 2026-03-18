/**
 * Friend profile page — view a Lichess friend's profile, stats, and games.
 * Allows importing games for analysis with Stockfish + Claude IA.
 */

import { t } from './i18n.js';
import { apiFetch } from './api.js';

let _container = null;
let _username = null;
let _offset = 0;
let _totalGames = 0;
const PAGE_SIZE = 20;

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
}

async function render(container, username) {
    _container = container;
    _username = username;
    _offset = 0;

    container.innerHTML = `<div class="friend-page-loading">${t('friend.loading')}</div>`;

    try {
        const profileResp = await apiFetch(`/api/friends/${encodeURIComponent(username)}/profile`);
        if (!profileResp.ok) throw new Error(`Profile fetch failed: ${profileResp.status}`);
        const profile = await profileResp.json();
        _totalGames = (profile.count && profile.count.all) || 0;
        renderPage(container, profile);
        await loadGames();
    } catch (e) {
        console.error('Friend page error:', e);
        container.innerHTML = `<div class="card"><div class="card-body"><p class="text-error">${t('friend.importError')}</p></div></div>`;
    }
}

function renderPage(container, profile) {
    const perfs = profile.perfs || {};
    const count = profile.count || {};
    const winRate = count.all > 0 ? Math.round((count.win / count.all) * 100) : 0;
    const memberSince = profile.createdAt
        ? new Date(profile.createdAt).toLocaleDateString()
        : '';
    const onlineClass = profile.online ? 'online' : '';
    const icons = { bullet: '\u26A1', blitz: '\uD83D\uDD25', rapid: '\uD83D\uDD50', classical: '\uD83C\uDFDB\uFE0F' };

    let ratingsHtml = '';
    for (const [cat, data] of Object.entries(perfs)) {
        ratingsHtml += `<div class="friend-rating-card">
            <div class="friend-rating-icon">${icons[cat] || ''}</div>
            <div class="friend-rating-value">${data.rating}</div>
            <div class="friend-rating-label">${cat.charAt(0).toUpperCase() + cat.slice(1)}</div>
            <div class="friend-rating-games">${data.games} ${t('friend.gamesPlayed').toLowerCase()}</div>
        </div>`;
    }

    const winPct = count.all > 0 ? Math.round((count.win / count.all) * 100) : 0;
    const lossPct = count.all > 0 ? Math.round((count.loss / count.all) * 100) : 0;
    const drawPct = count.all > 0 ? 100 - winPct - lossPct : 0;

    container.innerHTML = `
        <div class="friend-page">
            <div class="friend-page-nav">
                <a href="#live" class="btn btn-ghost btn-sm gap-1">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
                    ${t('friend.backToLive')}
                </a>
            </div>

            <div class="friend-profile-card">
                <div class="friend-profile-top">
                    <div class="friend-profile-avatar">
                        <span class="friend-avatar-letter">${escapeHtml((profile.username || '?')[0].toUpperCase())}</span>
                        <span class="friend-online-badge ${onlineClass}"></span>
                    </div>
                    <div class="friend-profile-info">
                        <div class="friend-profile-name-row">
                            <span class="friend-profile-username">${escapeHtml(profile.username)}</span>
                            <a href="https://lichess.org/@/${encodeURIComponent(profile.username)}" target="_blank" rel="noopener"
                               class="btn btn-ghost btn-xs btn-square" title="${t('friend.lichessProfile')}">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            </a>
                        </div>
                        ${memberSince ? `<div class="friend-profile-member-since">${t('friend.memberSince')} ${memberSince}</div>` : ''}
                    </div>
                </div>

                <div class="friend-winbar">
                    ${count.all > 0 ? `
                        <div class="friend-winbar-track">
                            <div class="friend-winbar-win" style="width:${winPct}%"></div>
                            <div class="friend-winbar-draw" style="width:${drawPct}%"></div>
                            <div class="friend-winbar-loss" style="width:${lossPct}%"></div>
                        </div>
                        <div class="friend-winbar-labels">
                            <span class="text-success">${count.win}V</span>
                            <span class="opacity-60">${count.draw}N</span>
                            <span class="text-error">${count.loss}D</span>
                            <span class="friend-winbar-total">${count.all} ${t('friend.gamesPlayed').toLowerCase()} &middot; ${winRate}%</span>
                        </div>
                    ` : `<span class="opacity-50">${t('friend.noGames')}</span>`}
                </div>
            </div>

            ${ratingsHtml ? `
            <div class="friend-section-title">${t('friend.ratings') || 'Classements'}</div>
            <div class="friend-ratings-grid">${ratingsHtml}</div>
            ` : ''}

            <div class="friend-section-title">${t('friend.games')}</div>
            <div class="friend-games-card">
                <div id="friend-games-table"></div>
                <div id="friend-games-pagination" class="friend-pagination"></div>
            </div>
        </div>
    `;
}

async function loadGames() {
    const tableEl = document.getElementById('friend-games-table');
    const paginationEl = document.getElementById('friend-games-pagination');
    if (!tableEl) return;

    tableEl.innerHTML = `<div class="friend-page-loading">${t('friend.loading')}</div>`;

    try {
        const gamesResp = await apiFetch(`/api/friends/${encodeURIComponent(_username)}/games?limit=${PAGE_SIZE}&offset=${_offset}`);
        if (!gamesResp.ok) throw new Error(`Games fetch failed: ${gamesResp.status}`);
        const games = await gamesResp.json();
        if (!games || games.length === 0) {
            tableEl.innerHTML = `<p class="opacity-60">${t('friend.noGames')}</p>`;
            if (paginationEl) paginationEl.innerHTML = '';
            return;
        }
        renderGamesTable(tableEl, games);
        renderPagination(paginationEl, games.length);
    } catch (e) {
        console.error('Load friend games error:', e);
        tableEl.innerHTML = `<p class="text-error">${t('friend.importError')}</p>`;
    }
}

function renderGamesTable(el, games) {
    const resultIcons = { win: '\u2714', loss: '\u2718', draw: '\u00BD' };
    const resultClasses = { win: 'text-success', loss: 'text-error', draw: 'opacity-60' };
    const speedIcons = { bullet: '\u26A1', blitz: '\uD83D\uDD25', rapid: '\uD83D\uDD50', classical: '\uD83C\uDFDB\uFE0F', correspondence: '\u2709' };

    let rows = '';
    for (const g of games) {
        const date = g.createdAt ? new Date(g.createdAt).toLocaleDateString() : '';
        const resultCls = resultClasses[g.result] || '';
        const resultIcon = resultIcons[g.result] || g.result;
        const speedIcon = speedIcons[g.speed] || '';
        const isAnalyzed = g.already_imported && g.analyzed;
        const btnClass = isAnalyzed ? 'btn-secondary' : 'btn-primary';
        const btnLabel = isAnalyzed ? t('friend.reviewGame') : t('friend.analyzeGame');
        const btnData = isAnalyzed
            ? `data-game-id="${escapeHtml(g.id)}" data-db-id="${g.db_game_id}" data-analyzed="1"`
            : `data-game-id="${escapeHtml(g.id)}"`;
        rows += `<tr>
            <td>${speedIcon} ${escapeHtml(g.opponent)} ${g.opponent_rating ? `(${g.opponent_rating})` : ''}</td>
            <td class="${resultCls} font-bold">${resultIcon}</td>
            <td>${escapeHtml(g.opening_name || g.opening_eco || '')}</td>
            <td>${date}</td>
            <td>
                <button class="btn ${btnClass} btn-sm friend-analyze-btn whitespace-nowrap" ${btnData}>
                    ${btnLabel}
                </button>
            </td>
        </tr>`;
    }

    el.innerHTML = `
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead>
                    <tr>
                        <th>${t('friend.opponent')}</th>
                        <th>${t('friend.result')}</th>
                        <th>${t('friend.opening')}</th>
                        <th>${t('friend.date')}</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;

    // Bind analyze buttons
    el.querySelectorAll('.friend-analyze-btn').forEach(btn => {
        btn.addEventListener('click', () => importAndAnalyze(btn));
    });
}

function renderPagination(el, fetchedCount) {
    if (!el) return;

    const currentPage = Math.floor(_offset / PAGE_SIZE);
    // Estimate total pages: use profile count.all if available, else infer from fetched count
    const hasMore = fetchedCount >= PAGE_SIZE;
    let totalPages;
    if (_totalGames > 0) {
        totalPages = Math.ceil(_totalGames / PAGE_SIZE);
    } else {
        // Fallback: at least currentPage + 1, +1 if there might be more
        totalPages = currentPage + 1 + (hasMore ? 1 : 0);
    }

    if (totalPages <= 1) {
        el.innerHTML = '';
        return;
    }

    let html = '';
    // First page button
    html += `<button class="btn btn-ghost btn-xs" ${currentPage === 0 ? 'disabled' : ''} data-page="0">&#8676;</button>`;
    // Previous button
    html += `<button class="btn btn-ghost btn-xs" ${currentPage === 0 ? 'disabled' : ''} data-page="${currentPage - 1}">&laquo;</button>`;

    // Page number buttons (window of 7 around current)
    const start = Math.max(0, currentPage - 3);
    const end = Math.min(totalPages, currentPage + 4);
    for (let i = start; i < end; i++) {
        html += `<button class="btn btn-xs ${i === currentPage ? 'btn-primary' : 'btn-ghost'}" data-page="${i}">${i + 1}</button>`;
    }

    // Next button
    html += `<button class="btn btn-ghost btn-xs" ${currentPage >= totalPages - 1 ? 'disabled' : ''} data-page="${currentPage + 1}">&raquo;</button>`;
    // Last page button
    html += `<button class="btn btn-ghost btn-xs" ${currentPage >= totalPages - 1 ? 'disabled' : ''} data-page="${totalPages - 1}">&#8677;</button>`;

    // Page jump input
    html += `<span class="text-sm opacity-60 ml-2">${t('games.page') || 'Page'} <input type="number" class="input input-bordered input-xs w-14" min="1" max="${totalPages}" value="${currentPage + 1}" id="friend-page-jump"> ${t('games.of') || 'sur'} ${totalPages}</span>`;

    el.innerHTML = html;

    // Bind page buttons
    el.querySelectorAll('.btn:not([disabled])').forEach(btn => {
        if (btn.dataset.page !== undefined) {
            btn.addEventListener('click', () => goToPage(parseInt(btn.dataset.page)));
        }
    });

    // Bind page jump input
    const jumpInput = document.getElementById('friend-page-jump');
    if (jumpInput) {
        jumpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = parseInt(jumpInput.value);
                if (!isNaN(val) && val >= 1 && val <= totalPages) {
                    goToPage(val - 1);
                }
            }
        });
    }
}

function goToPage(page) {
    _offset = page * PAGE_SIZE;
    loadGames();
}

async function importAndAnalyze(btn) {
    // Déjà analysée → navigation directe
    if (btn.dataset.analyzed === '1' && btn.dataset.dbId) {
        location.hash = `#review/${btn.dataset.dbId}`;
        return;
    }

    const gameId = btn.dataset.gameId;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('friend.importing');

    try {
        const resp = await apiFetch(`/api/friends/${encodeURIComponent(_username)}/import-game`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lichess_game_id: gameId }),
        });
        if (!resp.ok) throw new Error(`Import failed: ${resp.status}`);
        const data = await resp.json();
        if (data && data.game_id) {
            if (data.already_existed && data.analyzed) {
                btn.textContent = t('friend.reviewGame');
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-secondary');
                setTimeout(() => { location.hash = `#review/${data.game_id}`; }, 400);
            } else {
                btn.textContent = t('friend.importSuccess');
                setTimeout(() => { location.hash = `#review/${data.game_id}`; }, 500);
            }
        } else {
            throw new Error('No game_id returned');
        }
    } catch (e) {
        console.error('Import friend game error:', e);
        btn.textContent = t('friend.importError');
        btn.disabled = false;
        setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
    }
}

function destroy() {
    _container = null;
    _username = null;
    _offset = 0;
    _totalGames = 0;
}

export { render, destroy };
