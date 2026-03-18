/**
 * Dashboard page — stats, charts, evolution.
 * Refonte complette en layout grid de DaisyUI cards.
 */
import { t } from './i18n.js';
import { isFreeUser, getUser } from './user-state.js';
import { apiFetch } from './api.js';
import { initZoneDrag, destroyZoneDrag, openReorderModal } from './zone-drag.js';

let charts = [];
let dashboardData = null;
let currentPeriod = 'all';
let currentSpeed = null; // null = auto (dominant), or 'bullet'/'blitz'/'rapid'/'classical'
let _themeChangeHandler = null;
let _zoneDragInstance = null;

// Lazy-load Chart.js only when needed
let _chartReady = null;
function ensureChartJS() {
    if (_chartReady) return _chartReady;
    _chartReady = new Promise((resolve, reject) => {
        if (window.Chart) { resolve(window.Chart); return; }
        const s = document.createElement('script');
        s.src = '/static/vendor/chart.umd.min.js';
        s.onload = () => resolve(window.Chart);
        s.onerror = reject;
        document.head.appendChild(s);
    });
    return _chartReady;
}

function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hexToRgba(hex, alpha) {
    if (!hex || !hex.startsWith('#')) return `rgba(128,128,128,${alpha})`;
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

/** Read a DaisyUI theme color as a usable CSS color string. */
function getThemeColor(name) {
    return getCssVar(name) || '';
}

/** Get a color with opacity for grid lines, muted text, etc. */
function getThemeColorAlpha(name, alpha) {
    const raw = getCssVar(name);
    if (!raw) return `rgba(128,128,128,${alpha})`;
    if (raw.startsWith('#')) return hexToRgba(raw, alpha);
    return raw;
}

export async function render(container) {
    container.innerHTML = `
        <div class="dashboard">
            <div id="dash-loading" class="flex justify-center items-center py-20">
                <span class="loading loading-spinner loading-lg text-primary"></span>
            </div>
        </div>
    `;

    try {
        const resp = await fetch('/api/stats/dashboard');
        const data = await resp.json();
        buildDashboard(container.querySelector('.dashboard'), data);
    } catch (e) {
        container.querySelector('.dashboard').innerHTML =
            `<div class="card bg-base-200"><div class="card-body"><p class="opacity-60">${t('dashboard.noStats')}</p></div></div>`;
    }

    // Ecouter les changements de theme pour re-rendre les charts
    _themeChangeHandler = () => refreshCharts();
    window.addEventListener('themechange', _themeChangeHandler);
}

export function destroy() {
    if (_zoneDragInstance) { destroyZoneDrag(_zoneDragInstance); _zoneDragInstance = null; }
    for (const c of charts) {
        try { c.destroy(); } catch (e) {}
    }
    charts = [];
    dashboardData = null;
    currentPeriod = 'all';
    currentSpeed = null;
    if (_rangeSliderCleanup) { _rangeSliderCleanup(); _rangeSliderCleanup = null; }
    if (_themeChangeHandler) {
        window.removeEventListener('themechange', _themeChangeHandler);
        _themeChangeHandler = null;
    }
    if (_dashPreviewGround) {
        _dashPreviewGround.destroy();
        _dashPreviewGround = null;
    }
    _dashAnimId++;
}

// ─── Beginner state: 0 parties ────────────────────────────────────────────────
function buildWelcomeGuide(root) {
    root.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16 gap-6">
            <div class="text-6xl opacity-30">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <line x1="9" y1="3" x2="9" y2="21"/>
                    <line x1="15" y1="3" x2="15" y2="21"/>
                    <line x1="3" y1="9" x2="21" y2="9"/>
                    <line x1="3" y1="15" x2="21" y2="15"/>
                </svg>
            </div>
            <h2 class="text-2xl font-bold">${t('dashboard.welcomeTitle')}</h2>
            <p class="text-base opacity-70 max-w-md text-center">${t('dashboard.welcomeDesc')}</p>
            <a href="#live" class="btn btn-primary btn-lg">${t('dashboard.playFirst')}</a>
        </div>
    `;
}

// ─── Main build ───────────────────────────────────────────────────────────────
async function buildDashboard(root, data) {
    // T049: si 0 parties, afficher le guide de bienvenue
    if (!data.games_played || data.games_played === 0) {
        buildWelcomeGuide(root);
        return;
    }

    const winPct = data.games_played ? Math.round(data.wins / data.games_played * 100) : 0;
    const lossPct = data.games_played ? Math.round(data.losses / data.games_played * 100) : 0;
    const drawPct = data.games_played ? 100 - winPct - lossPct : 0;

    // Auto-analysis banner
    const ap = data.analysis_progress;
    let bannerHtml = '';
    if (ap && ap.total > 0 && ap.pending > 0) {
        const pct = Math.round(ap.analysed / ap.total * 100);
        bannerHtml = `
            <div class="alert alert-warning shadow-sm mb-4">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                <div class="flex-1">
                    <div class="font-semibold text-sm">${t('dashboard.autoAnalysisTitle')}</div>
                    <div class="text-xs opacity-80">${t('dashboard.autoAnalysisDesc', { analysed: ap.analysed, total: ap.total, pending: ap.pending })}</div>
                    <progress class="progress progress-warning w-full mt-1" value="${pct}" max="100"></progress>
                </div>
            </div>
        `;
    }

    // Upsell card for free users
    let upsellHtml = '';
    if (isFreeUser() && !localStorage.getItem('chess-learn-dismiss-dash-upsell')) {
        upsellHtml = `
            <div class="alert alert-info shadow-lg mb-4" id="dash-upsell-card">
                <div class="flex-1">
                    <div class="font-semibold">${t('upsell.premiumInsights')}</div>
                    <div class="text-sm opacity-80">${t('upsell.dashboardDesc')}</div>
                    <a href="#subscription" class="btn btn-sm btn-primary mt-2">${t('subscription.upgrade')}</a>
                </div>
                <button class="btn btn-ghost btn-sm btn-circle" data-dismiss="dash-upsell-card">&times;</button>
            </div>
        `;
    }

    // Streak badge
    const streak = data.current_streak || { type: 'none', count: 0 };
    let streakHtml = '';
    if (streak.count > 0 && streak.type !== 'none') {
        const streakLabel = streak.type === 'win'
            ? t('dashboard.streakWin', { n: streak.count })
            : streak.type === 'loss'
                ? t('dashboard.streakLoss', { n: streak.count })
                : t('dashboard.streakDraw', { n: streak.count });
        const streakClass = streak.type === 'win' ? 'pill-success' : streak.type === 'loss' ? 'pill-error' : 'pill-warning';
        streakHtml = `<span class="pill ${streakClass} pill-xs mt-1">${streakLabel}</span>`;
    }

    // Last AI tip
    const aiTip = data.last_ai_tip;
    let aiTipHtml = '';
    if (aiTip) {
        aiTipHtml = `
            <div class="card bg-base-200 shadow-sm">
                <div class="card-body py-4">
                    <h4 class="card-title text-base">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/><line x1="9" y1="22" x2="15" y2="22"/></svg>
                        ${t('dashboard.aiTipTitle')}
                    </h4>
                    <div class="opacity-90 ai-tip-content">${simpleMarkdown(aiTip)}</div>
                </div>
            </div>
        `;
    }

    root.innerHTML = `
        ${bannerHtml}
        ${upsellHtml}

        <!-- Hero Stats -->
        <div class="dash-hero grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4" role="region" aria-label="${t('dashboard.statsOverview')}">
            <div class="card bg-base-200 shadow-sm">
                <div class="card-body p-4 gap-1">
                    <div class="text-xs uppercase tracking-wider opacity-50">${t('dashboard.gamesPlayed')}</div>
                    <div class="text-3xl font-extrabold tracking-tight">${data.games_played}</div>
                    ${streakHtml}
                </div>
            </div>
            <div class="card bg-base-200 shadow-sm">
                <div class="card-body p-4 gap-1">
                    <div class="text-xs uppercase tracking-wider opacity-50">${t('dashboard.winRate')}</div>
                    <div class="text-3xl font-extrabold tracking-tight text-success">${winPct}<span class="text-lg">%</span></div>
                    <div class="flex h-1.5 rounded-full overflow-hidden mt-1" role="img" aria-label="${winPct}% ${t('dashboard.winsLabel')}, ${drawPct}% ${t('dashboard.drawsLabel')}, ${lossPct}% ${t('dashboard.lossesLabel')}">
                        <div style="width:${winPct}%;background:#2ecc71"></div>
                        <div style="width:${Math.max(drawPct, 1)}%;background:#8d7b68"></div>
                        <div style="width:${lossPct}%;background:#e74c3c"></div>
                    </div>
                    <div class="flex gap-3 mt-1 text-xs opacity-50">
                        <span>${data.wins}V</span>
                        <span>${data.draws}N</span>
                        <span>${data.losses}D</span>
                    </div>
                </div>
            </div>
            <div class="card bg-base-200 shadow-sm">
                <div class="card-body p-4 gap-1">
                    <div class="text-xs uppercase tracking-wider opacity-50">${t('dashboard.avgAccuracy')}</div>
                    <div class="text-3xl font-extrabold tracking-tight text-info">${data.avg_accuracy}<span class="text-lg">%</span></div>
                    <div class="w-full bg-base-300 rounded-full h-1.5 mt-1">
                        <div class="h-1.5 rounded-full" style="width:${data.avg_accuracy}%;background:#00bcd4"></div>
                    </div>
                </div>
            </div>
            <div class="card bg-base-200 shadow-sm">
                <div class="card-body p-4 gap-1">
                    <div class="text-xs uppercase tracking-wider opacity-50">${t('dashboard.avgBlunders')}</div>
                    <div class="text-3xl font-extrabold tracking-tight text-error">${data.avg_blunder_rate}</div>
                    <div class="text-xs opacity-50">${t('dashboard.perGame')}</div>
                </div>
            </div>
        </div>

        <!-- Main grid: 3 colonnes desktop, 2 tablette, 1 mobile -->
        <div class="dash-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
            <button class="btn btn-sm btn-ghost zone-customize-btn dash-customize-btn xl:col-span-3 md:col-span-2 justify-self-end" aria-label="${t('layout.customizeLayout')}">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="1.5" fill="currentColor"/><circle cx="11" cy="8" r="1.5" fill="currentColor"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/></svg>
                ${t('layout.customizeLayout') || 'Personnaliser'}
            </button>

            <!-- Rating Trend (large, spans 2 cols on desktop) — Lichess-style -->
            <div class="card bg-base-200 shadow-sm chart-container xl:col-span-2" data-zone-id="rating" role="img" aria-label="${t('dashboard.ratingTrend')}">
                <div class="card-body py-3">
                    <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <h4 class="card-title text-base mb-0">${t('dashboard.ratingTrend')}</h4>
                        <div class="flex gap-2 flex-wrap">
                            <div class="join" id="speed-selector"></div>
                            <div class="join">
                                <button class="btn btn-xs join-item period-btn" data-period="30d">${t('dashboard.period30d')}</button>
                                <button class="btn btn-xs join-item period-btn" data-period="3m">${t('dashboard.period3m')}</button>
                                <button class="btn btn-xs join-item period-btn" data-period="6m">${t('dashboard.period6m')}</button>
                                <button class="btn btn-xs join-item period-btn btn-active" data-period="all">${t('dashboard.periodAll')}</button>
                            </div>
                        </div>
                    </div>
                    <div class="chart-wrap" id="wrap-chart-rating"><canvas id="chart-rating"></canvas></div>
                    <div class="rating-time-slider">
                        <span class="rating-time-label" id="rating-date-start"></span>
                        <div class="rating-range-wrap">
                            <input type="range" min="0" max="100" value="0" class="rating-range rating-range-min" id="rating-range-min">
                            <input type="range" min="0" max="100" value="100" class="rating-range rating-range-max" id="rating-range-max">
                        </div>
                        <span class="rating-time-label" id="rating-date-end"></span>
                    </div>
                </div>
            </div>

            <!-- Radar Chart: Strengths/Weaknesses -->
            <div class="card bg-base-200 shadow-sm chart-container" data-zone-id="radar" role="img" aria-label="${t('dashboard.radarTitle')}">
                <div class="card-body py-3">
                    <h4 class="card-title text-base">${t('dashboard.radarTitle')}</h4>
                    <div class="chart-wrap chart-wrap-radar" id="wrap-chart-radar"><canvas id="chart-radar"></canvas></div>
                </div>
            </div>

            <!-- Phase Evolution -->
            <div class="card bg-base-200 shadow-sm chart-container xl:col-span-2" data-zone-id="phase" role="img" aria-label="${t('dashboard.phaseEvolution')}">
                <div class="card-body py-3">
                    <h4 class="card-title text-base">${t('dashboard.phaseEvolution')}</h4>
                    <div class="chart-wrap" id="wrap-chart-phases"><canvas id="chart-phases"></canvas></div>
                </div>
            </div>

            <!-- Move Classification Pie Chart -->
            <div class="card bg-base-200 shadow-sm chart-container" data-zone-id="pie" role="img" aria-label="${t('dashboard.moveDistribution')}">
                <div class="card-body py-3">
                    <h4 class="card-title text-base">${t('dashboard.moveDistribution')}</h4>
                    <div class="chart-wrap chart-wrap-pie" id="wrap-chart-pie"><canvas id="chart-pie"></canvas></div>
                </div>
            </div>

            <!-- Openings + AI Tip — 2-column sub-grid -->
            <div class="xl:col-span-3 md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4" data-zone-id="openings">
                <!-- Left: Openings stacked -->
                <div class="flex flex-col gap-4">
                    <!-- Top Openings -->
                    <div class="card bg-base-200 shadow-sm">
                        <div class="card-body py-3">
                            <h4 class="card-title text-base">${t('dashboard.topOpenings')}</h4>
                            <div id="top-openings-list"></div>
                        </div>
                    </div>
                    <!-- All Openings (existing) -->
                    <div class="card bg-base-200 shadow-sm">
                        <div class="card-body py-3">
                            <h4 class="card-title text-base">${t('dashboard.favoriteOpenings')}</h4>
                            <div class="dash-openings" id="openings-list"></div>
                        </div>
                    </div>
                </div>
                <!-- Right: AI Coaching Tip -->
                ${aiTipHtml}
            </div>
        </div>
        <div class="opening-preview" id="dash-opening-preview"><div class="cg-wrap" id="dash-opening-preview-board"></div></div>
    `;

    dashboardData = data;
    currentPeriod = 'all';
    ensureChartJS().then(() => renderCharts(data)).catch(e => console.warn('Chart.js load failed:', e));
    renderTopOpenings(data.top_openings || []);
    renderOpenings(data.openings || []);
    attachDashOpeningHover();

    // Period selector
    root.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            root.querySelectorAll('.period-btn').forEach(b => b.classList.remove('btn-active'));
            btn.classList.add('btn-active');
            currentPeriod = btn.dataset.period;
            refreshCharts();
        });
    });

    // Dismiss handler for upsell card
    root.querySelector('[data-dismiss="dash-upsell-card"]')?.addEventListener('click', () => {
        localStorage.setItem('chess-learn-dismiss-dash-upsell', '1');
        document.getElementById('dash-upsell-card')?.remove();
    });

    // Zone drag & drop for dashboard layout (si activé par l'admin)
    try {
        const meResp = await apiFetch('/api/auth/me');
        const meData = meResp.ok ? await meResp.json() : {};
        const layoutEnabled = meData.layout_customization_enabled !== false;
        const layoutPrefs = meData.layout_preferences || {};
        const dashPrefs = layoutPrefs.dashboard || {};
        const dashGrid = root.querySelector('.dash-grid');
        if (dashGrid && layoutEnabled) {
            _zoneDragInstance = initZoneDrag({
                page: 'dashboard',
                container: dashGrid,
                defaultOrder: ['rating', 'radar', 'phase', 'pie', 'openings'],
                savedPositions: dashPrefs.positions || null,
                savedOrder: dashPrefs.order || null,
            });
            const customizeBtn = root.querySelector('.dash-customize-btn');
            if (customizeBtn) {
                customizeBtn.addEventListener('click', () => openReorderModal(_zoneDragInstance));
            }
        } else {
            root.querySelector('.dash-customize-btn')?.remove();
        }
    } catch (_) { /* zone-drag non-critique */ }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/* ─── Lightweight Markdown → HTML for AI tips ─── */
function simpleMarkdown(text) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    const lines = escaped.split('\n');
    const out = [];
    let inList = false;
    let listType = ''; // 'ul' or 'ol'

    function closeList() {
        if (inList) { out.push(`</${listType}>`); inList = false; }
    }

    for (const line of lines) {
        // Headings
        if (line.startsWith('### ')) { closeList(); out.push(`<h5 class="font-bold mt-3 mb-1 text-sm">${line.slice(4)}</h5>`); continue; }
        if (line.startsWith('## ')) { closeList(); out.push(`<h4 class="font-bold text-base mt-4 mb-1">${line.slice(3)}</h4>`); continue; }
        if (line.startsWith('# ')) { closeList(); out.push(`<h3 class="font-bold text-lg mt-4 mb-2">${line.slice(2)}</h3>`); continue; }
        // Horizontal rule
        if (/^-{3,}$/.test(line.trim())) { closeList(); out.push('<hr class="my-3 border-base-content/20">'); continue; }
        // Unordered list
        if (/^[-*] /.test(line)) {
            if (!inList || listType !== 'ul') { closeList(); out.push('<ul class="list-disc ml-5 my-1 text-sm space-y-0.5">'); inList = true; listType = 'ul'; }
            out.push(`<li>${line.replace(/^[-*] /, '')}</li>`);
            continue;
        }
        // Ordered list
        if (/^\d+\.\s/.test(line)) {
            if (!inList || listType !== 'ol') { closeList(); out.push('<ol class="list-decimal ml-5 my-1 text-sm space-y-0.5">'); inList = true; listType = 'ol'; }
            out.push(`<li>${line.replace(/^\d+\.\s/, '')}</li>`);
            continue;
        }
        // Empty line
        if (line.trim() === '') { closeList(); out.push('<div class="h-2"></div>'); continue; }
        // Regular paragraph
        closeList();
        out.push(`<p class="text-sm my-0.5">${line}</p>`);
    }
    closeList();

    return out.join('\n')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function formatShortDate(dateStr) {
    if (!dateStr) return '?';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '?';
    const months = {
        fr: ['jan','fev','mar','avr','mai','jun','jul','aou','sep','oct','nov','dec'],
        en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        es: ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'],
    };
    const lang = (localStorage.getItem('chess-learn-lang') || 'fr').slice(0, 2);
    const m = (months[lang] || months.fr)[d.getMonth()];
    return `${d.getDate()} ${m}`;
}

function formatFullDate(dateStr) {
    if (!dateStr) return '?';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '?';
    const months = {
        fr: ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'],
        en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        es: ['ene.','feb.','mar.','abr.','may.','jun.','jul.','ago.','sep.','oct.','nov.','dic.'],
    };
    const lang = (localStorage.getItem('chess-learn-lang') || 'fr').slice(0, 2);
    const m = (months[lang] || months.fr)[d.getMonth()];
    return `${d.getDate()} ${m} ${d.getFullYear()}`;
}

function computeMovingAverage(values, window) {
    const result = [];
    for (let i = 0; i < values.length; i++) {
        const start = Math.max(0, i - window + 1);
        const slice = values.slice(start, i + 1);
        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
        result.push(Math.round(avg * 10) / 10);
    }
    return result;
}

/** Classify a time_control string (e.g. "10+0") into a Lichess speed category. */
function classifyTimeControl(tc) {
    if (!tc) return 'unknown';
    if (tc === 'correspondence') return 'correspondence';
    const parts = tc.split('+');
    let initial = parseInt(parts[0]) || 0;
    const inc = parseInt(parts[1]) || 0;
    if (initial === 0 && inc === 0) return 'correspondence';
    const totalEstimate = initial + inc * 0.67; // estimated game duration in minutes
    if (totalEstimate < 3) return 'bullet';
    if (totalEstimate < 8) return 'blitz';
    if (totalEstimate < 25) return 'rapid';
    return 'classical';
}

/** Filter rating history to keep only the most played speed category. */
function filterByDominantSpeed(history) {
    if (!history || history.length === 0) return { filtered: history, speed: 'all' };
    const counts = {};
    for (const h of history) {
        const spd = classifyTimeControl(h.time_control);
        counts[spd] = (counts[spd] || 0) + 1;
    }
    // Find dominant speed (ignore 'unknown' and 'correspondence')
    let bestSpeed = 'unknown';
    let bestCount = 0;
    for (const [spd, cnt] of Object.entries(counts)) {
        if (spd !== 'unknown' && spd !== 'correspondence' && cnt > bestCount) {
            bestSpeed = spd;
            bestCount = cnt;
        }
    }
    return {
        filtered: history.filter(h => classifyTimeControl(h.time_control) === bestSpeed),
        speed: bestSpeed,
        counts,
    };
}

function filterByPeriod(history, period) {
    if (!history || period === 'all') return history || [];
    const now = Date.now();
    const cutoffs = { '30d': 30, '3m': 90, '6m': 180 };
    const days = cutoffs[period] || Infinity;
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    return history.filter(h => {
        if (!h.played_at) return false;
        return new Date(h.played_at).getTime() >= cutoff;
    });
}

async function refreshCharts() {
    if (!dashboardData) return;
    for (const c of charts) {
        try { c.destroy(); } catch (e) {}
    }
    charts = [];
    // Re-creer les canvas (Chart.js a besoin de canvas frais apres destroy)
    // Use wrapper IDs to always find the right parent, even if canvas was replaced by a <p>
    const canvasIds = ['chart-rating', 'chart-phases', 'chart-pie', 'chart-radar'];
    for (const id of canvasIds) {
        const wrap = document.getElementById('wrap-' + id);
        if (wrap) {
            wrap.innerHTML = `<canvas id="${id}"></canvas>`;
        }
    }
    // Reset range sliders to full range
    const rMin = document.getElementById('rating-range-min');
    const rMax = document.getElementById('rating-range-max');
    if (rMin) rMin.value = 0;
    if (rMax) rMax.value = 100;
    try {
        await ensureChartJS();
    } catch (e) {
        console.warn('Chart.js load failed:', e);
        return;
    }
    renderCharts(dashboardData);
}

function renderCharts(data) {
    if (typeof Chart === 'undefined') return;

    const primary = getThemeColor('--color-primary') || '#c9a84c';
    const baseContent = getThemeColor('--color-base-content') || '#888';
    const muted = hexToRgba(baseContent.startsWith('#') ? baseContent : '#888888', 0.6);
    const gridColor = hexToRgba(baseContent.startsWith('#') ? baseContent : '#888888', 0.1);
    const accent = primary;
    const filtered = filterByPeriod(data.accuracy_history, currentPeriod);

    // === Chart 1: Rating over time — Lichess-style ===
    const ratingHistoryAll = data.rating_history || [];

    // Detect available speeds and filter by dominant/selected
    const speedLabels = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', correspondence: 'Corr.' };
    const { speed: dominantSpeed, counts: speedCounts } = filterByDominantSpeed(ratingHistoryAll);
    const activeSpeed = currentSpeed || dominantSpeed;

    // Build speed selector buttons
    const speedSelector = document.getElementById('speed-selector');
    if (speedSelector && speedCounts) {
        const availableSpeeds = Object.entries(speedCounts)
            .filter(([s]) => s !== 'unknown')
            .sort((a, b) => b[1] - a[1]);
        if (availableSpeeds.length > 1) {
            speedSelector.innerHTML = availableSpeeds.map(([spd, cnt]) =>
                `<button class="btn btn-xs join-item speed-btn${spd === activeSpeed ? ' btn-active' : ''}" data-speed="${spd}">${speedLabels[spd] || spd}</button>`
            ).join('');
            speedSelector.querySelectorAll('.speed-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    currentSpeed = btn.dataset.speed;
                    refreshCharts();
                });
            });
        }
    }

    const ratingHistory = ratingHistoryAll.filter(h => classifyTimeControl(h.time_control) === activeSpeed);
    const filteredRating = filterByPeriod(ratingHistory, currentPeriod);
    if (filteredRating && filteredRating.length >= 2) {
        const ctx = document.getElementById('chart-rating');
        if (ctx) { try {
            const history = filteredRating;
            const labels = history.map(h => formatShortDate(h.played_at));
            const values = history.map(h => h.our_rating || 0);
            const maxVal = Math.max(...values);
            const minVal = Math.min(...values.filter(v => v > 0));
            const padding = 50;

            // Crosshair + on-chart label plugin
            const crosshairPlugin = {
                id: 'ratingCrosshair',
                afterDraw(chart) {
                    if (chart._ratingTooltip) {
                        const { x, y, date, elo } = chart._ratingTooltip;
                        const { chartArea } = chart;
                        const ctx2 = chart.ctx;
                        // Vertical line
                        ctx2.save();
                        ctx2.beginPath();
                        ctx2.setLineDash([4, 3]);
                        ctx2.strokeStyle = 'rgba(255,255,255,0.3)';
                        ctx2.lineWidth = 1;
                        ctx2.moveTo(x, chartArea.top);
                        ctx2.lineTo(x, chartArea.bottom);
                        ctx2.stroke();
                        ctx2.setLineDash([]);
                        // Label background
                        ctx2.font = '600 12px sans-serif';
                        const dateMsr = ctx2.measureText(date);
                        const eloMsr = ctx2.measureText(elo);
                        const boxW = Math.max(dateMsr.width, eloMsr.width) + 12;
                        const boxH = 36;
                        let boxX = x - boxW / 2;
                        let boxY = y - boxH - 10;
                        // Keep within bounds
                        if (boxX < chartArea.left) boxX = chartArea.left;
                        if (boxX + boxW > chartArea.right) boxX = chartArea.right - boxW;
                        if (boxY < chartArea.top) boxY = y + 10;
                        ctx2.fillStyle = 'rgba(0,0,0,0.8)';
                        ctx2.beginPath();
                        ctx2.roundRect(boxX, boxY, boxW, boxH, 4);
                        ctx2.fill();
                        // Date text
                        ctx2.fillStyle = 'rgba(255,255,255,0.6)';
                        ctx2.font = '11px sans-serif';
                        ctx2.textAlign = 'center';
                        ctx2.fillText(date, boxX + boxW / 2, boxY + 14);
                        // ELO text
                        ctx2.fillStyle = '#2ecc71';
                        ctx2.font = '600 13px sans-serif';
                        ctx2.fillText(elo, boxX + boxW / 2, boxY + 29);
                        ctx2.restore();
                    }
                },
            };

            const ratingChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: t('dashboard.rating'),
                            data: values,
                            borderColor: '#2ecc71',
                            backgroundColor: 'rgba(46, 204, 113, 0.06)',
                            fill: true,
                            borderWidth: 1.5,
                            tension: 0,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            pointBackgroundColor: '#2ecc71',
                            pointBorderColor: '#2ecc71',
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { bottom: 4, top: 4 } },
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false },
                    },
                    scales: {
                        y: {
                            position: 'right',
                            min: Math.max(0, minVal - padding),
                            max: maxVal + padding,
                            grid: { color: gridColor },
                            ticks: { color: muted },
                        },
                        x: {
                            display: true,
                            grid: { display: false },
                            ticks: {
                                color: muted,
                                maxTicksLimit: 8,
                                maxRotation: 0,
                                font: { size: 10 },
                            },
                        },
                    },
                    onHover: (evt, elements) => {
                        if (elements.length > 0) {
                            const idx = elements[0].index;
                            const curHistory = ratingChart._ratingHistory || history;
                            const curValues = ratingChart._ratingRawValues || values;
                            const h = curHistory[idx];
                            const meta = ratingChart.getDatasetMeta(0);
                            const pt = meta.data[idx];
                            if (pt) {
                                ratingChart._ratingTooltip = {
                                    x: pt.x,
                                    y: pt.y,
                                    date: formatFullDate(h?.played_at),
                                    elo: `${curValues[idx] || '?'}`,
                                };
                            }
                        } else {
                            ratingChart._ratingTooltip = null;
                        }
                        ratingChart.draw();
                    },
                },
                plugins: [crosshairPlugin],
            });

            // Clear tooltip when mouse leaves
            ctx.addEventListener('mouseleave', () => {
                ratingChart._ratingTooltip = null;
                ratingChart.draw();
            });

            charts.push(ratingChart);

            // Restore slider visibility (may have been hidden by a previous no-data state)
            const sliderEl = document.querySelector('.rating-time-slider');
            if (sliderEl) sliderEl.style.display = '';

            // Setup dual range slider
            setupRatingRangeSlider(ratingHistory, history, ratingChart, values);

            // Drag-to-pan on chart: drag right → slide window toward past (left)
            let _panStartX = null;
            ctx.style.cursor = 'grab';
            ctx.addEventListener('pointerdown', (e) => {
                _panStartX = e.clientX;
                ctx.style.cursor = 'grabbing';
                ctx.setPointerCapture(e.pointerId);
            });
            ctx.addEventListener('pointermove', (e) => {
                if (_panStartX === null) return;
                const dx = e.clientX - _panStartX;
                const chartWidth = ctx.getBoundingClientRect().width;
                // Threshold: need at least 4px of movement
                if (Math.abs(dx) < 4) return;
                _panStartX = e.clientX;

                const sMin = document.getElementById('rating-range-min');
                const sMax = document.getElementById('rating-range-max');
                if (!sMin || !sMax) return;

                const lo = parseInt(sMin.value);
                const hi = parseInt(sMax.value);
                const span = hi - lo;
                if (span >= 100) return; // Full range, nothing to pan

                // Convert pixel drag to percentage shift (inverted: drag right → shift left)
                const shiftPct = -Math.round(dx / chartWidth * 100);
                if (shiftPct === 0) return;

                let newLo = lo + shiftPct;
                let newHi = hi + shiftPct;
                // Clamp
                if (newLo < 0) { newHi -= newLo; newLo = 0; }
                if (newHi > 100) { newLo -= (newHi - 100); newHi = 100; }
                newLo = Math.max(0, newLo);
                newHi = Math.min(100, newHi);

                sMin.value = newLo;
                sMax.value = newHi;
                sMin.dispatchEvent(new Event('input'));
            });
            ctx.addEventListener('pointerup', () => {
                _panStartX = null;
                ctx.style.cursor = 'grab';
            });
            ctx.addEventListener('lostpointercapture', () => {
                _panStartX = null;
                ctx.style.cursor = 'grab';
            });
        } catch (e) { console.warn('Chart rating error:', e); } }
    } else {
        // No rating data for this speed/period — show placeholder
        const ctx = document.getElementById('chart-rating');
        if (ctx) {
            const wrap = ctx.parentElement;
            wrap.innerHTML = `<p class="opacity-60 text-center py-10">${t('dashboard.noRatingData')}</p>`;
        }
        const sliderEl = document.querySelector('.rating-time-slider');
        if (sliderEl) sliderEl.style.display = 'none';
    }

    // === Chart 2: Phase evolution (3 lines: opening, middlegame, endgame) ===
    if (filtered && filtered.length) {
        const ctx = document.getElementById('chart-phases');
        if (ctx) { try {
            const phaseHistory = filtered.filter(h =>
                h.opening_accuracy != null || h.middlegame_accuracy != null || h.endgame_accuracy != null
            );

            if (phaseHistory.length >= 2) {
                const labels = phaseHistory.map(h => formatShortDate(h.played_at));
                const openingRaw = phaseHistory.map(h => h.opening_accuracy ?? null);
                const middlegameRaw = phaseHistory.map(h => h.middlegame_accuracy ?? null);
                const endgameRaw = phaseHistory.map(h => h.endgame_accuracy ?? null);

                // Smooth with moving average (window ~10% of data, min 5)
                const smoothWin = Math.max(5, Math.round(phaseHistory.length / 10));
                function smoothNullable(arr, win) {
                    // Moving average that skips nulls
                    const result = [];
                    for (let i = 0; i < arr.length; i++) {
                        const start = Math.max(0, i - win + 1);
                        const slice = arr.slice(start, i + 1).filter(v => v != null);
                        result.push(slice.length ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length * 10) / 10 : null);
                    }
                    return result;
                }
                const openingVals = smoothNullable(openingRaw, smoothWin);
                const middlegameVals = smoothNullable(middlegameRaw, smoothWin);
                const endgameVals = smoothNullable(endgameRaw, smoothWin);

                const blue = '#3498db';   // Ouverture — bleu fixe
                const gold = '#f1c40f';   // Milieu de jeu — jaune/or fixe
                const green = '#2ecc71';  // Finale — vert fixe

                charts.push(new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: t('dashboard.opening'),
                                data: openingVals,
                                borderColor: blue,
                                backgroundColor: hexToRgba(blue, 0.08),
                                borderWidth: 2,
                                tension: 0.4,
                                pointRadius: 0,
                                pointHoverRadius: 4,
                                spanGaps: true,
                            },
                            {
                                label: t('dashboard.middlegame'),
                                data: middlegameVals,
                                borderColor: gold,
                                backgroundColor: hexToRgba(gold, 0.08),
                                borderWidth: 2,
                                tension: 0.4,
                                pointRadius: 0,
                                pointHoverRadius: 4,
                                spanGaps: true,
                            },
                            {
                                label: t('dashboard.endgame'),
                                data: endgameVals,
                                borderColor: green,
                                backgroundColor: hexToRgba(green, 0.08),
                                borderWidth: 2,
                                tension: 0.4,
                                pointRadius: 0,
                                pointHoverRadius: 4,
                                spanGaps: true,
                            },
                        ],
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        layout: { padding: { bottom: 8, top: 4 } },
                        interaction: {
                            mode: 'index',
                            intersect: false,
                        },
                        plugins: {
                            legend: {
                                display: true,
                                position: 'top',
                                align: 'end',
                                labels: {
                                    color: muted,
                                    usePointStyle: true,
                                    pointStyle: 'circle',
                                    font: { size: 11 },
                                    padding: 12,
                                },
                            },
                            tooltip: {
                                mode: 'index',
                                intersect: false,
                                callbacks: {
                                    title: (items) => {
                                        const idx = items[0]?.dataIndex;
                                        if (idx == null) return '';
                                        return formatFullDate(phaseHistory[idx]?.played_at);
                                    },
                                    label: (item) => {
                                        const val = item.raw;
                                        if (val == null) return '';
                                        return ` ${item.dataset.label}: ${Math.round(val)}%`;
                                    },
                                },
                            },
                        },
                        scales: {
                            y: {
                                min: 0, max: 100,
                                grid: { color: gridColor },
                                ticks: {
                                    color: muted,
                                    callback: (v) => `${v}%`,
                                },
                            },
                            x: {
                                grid: { display: false },
                                ticks: {
                                    color: muted,
                                    maxTicksLimit: 12,
                                    maxRotation: 0,
                                },
                            },
                        },
                    },
                }));
            } else {
                ctx.parentElement.innerHTML = `<p class="opacity-60 text-center py-10">${t('dashboard.noStats')}</p>`;
            }
        } catch (e) { console.warn('Chart phases error:', e); } }
    }

    // === Chart 3: Move classification — Pie/Doughnut chart ===
    if (data.error_distribution) {
        const ctx = document.getElementById('chart-pie');
        if (ctx) { try {
            const dist = data.error_distribution;
            const labels = [t('chart.brilliant'), t('chart.excellent'), t('chart.good'), t('chart.inaccuracy'), t('chart.mistake'), t('chart.blunder')];
            const values = [dist.brilliant||0, dist.great||0, dist.good||0, dist.inaccuracy||0, dist.mistake||0, dist.blunder||0];
            const colors = [
                getThemeColor('--move-brilliant') || '#00e5ff',
                getThemeColor('--move-great') || '#5499c7',
                getThemeColor('--move-good') || '#5d8a3e',
                getThemeColor('--move-inaccuracy') || '#d4a017',
                getThemeColor('--move-mistake') || '#e67e22',
                getThemeColor('--move-blunder') || '#c0392b',
            ];
            const total = values.reduce((a, b) => a + b, 0);

            charts.push(new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        data: values,
                        backgroundColor: colors,
                        borderWidth: 2,
                        borderColor: getThemeColor('--color-base-200') || '#1a1a2e',
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '55%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: muted,
                                usePointStyle: true,
                                pointStyle: 'circle',
                                font: { size: 11 },
                                padding: 10,
                            },
                        },
                        tooltip: {
                            callbacks: {
                                label: (c) => {
                                    const pct = total > 0 ? Math.round(c.raw / total * 100) : 0;
                                    return ` ${c.label}: ${c.raw} ${t('dashboard.moves')} (${pct}%)`;
                                },
                            },
                        },
                    },
                },
            }));
        } catch (e) { console.warn('Chart pie error:', e); } }
    }

    // === Chart 4: Radar chart — forces/faiblesses ===
    const radar = data.radar_data;
    if (radar) {
        const ctx = document.getElementById('chart-radar');
        if (ctx) { try {
            const radarLabels = [
                t('dashboard.opening'),
                t('dashboard.middlegame'),
                t('dashboard.endgame'),
                t('dashboard.tactic'),
            ];
            const radarValues = [radar.opening, radar.middlegame, radar.endgame, radar.tactic];

            charts.push(new Chart(ctx, {
                type: 'radar',
                data: {
                    labels: radarLabels,
                    datasets: [{
                        label: t('dashboard.yourProfile'),
                        data: radarValues,
                        borderColor: accent,
                        backgroundColor: hexToRgba(accent, 0.15),
                        borderWidth: 2,
                        pointBackgroundColor: accent,
                        pointBorderColor: accent,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        r: {
                            min: 0,
                            max: 100,
                            ticks: {
                                stepSize: 25,
                                color: muted,
                                backdropColor: 'transparent',
                                font: { size: 10 },
                            },
                            grid: { color: gridColor },
                            angleLines: { color: gridColor },
                            pointLabels: {
                                color: baseContent.startsWith('#') ? baseContent : '#ccc',
                                font: { size: 12, weight: '600' },
                            },
                        },
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (item) => ` ${item.label}: ${item.raw}%`,
                            },
                        },
                    },
                },
            }));
        } catch (e) { console.warn('Chart radar error:', e); } }
    }
}

// ─── Dual range slider for rating chart ───────────────────────────────────────
let _rangeSliderCleanup = null;

function setupRatingRangeSlider(allHistory, visibleHistory, chart, rawValues) {
    if (_rangeSliderCleanup) { _rangeSliderCleanup(); _rangeSliderCleanup = null; }

    const sliderMin = document.getElementById('rating-range-min');
    const sliderMax = document.getElementById('rating-range-max');
    const dateStart = document.getElementById('rating-date-start');
    const dateEnd = document.getElementById('rating-date-end');
    if (!sliderMin || !sliderMax || !allHistory || allHistory.length < 2) return;

    const totalLen = allHistory.length;
    const visibleLen = visibleHistory.length;
    const startPct = totalLen > 0 ? Math.round((totalLen - visibleLen) / totalLen * 100) : 0;

    sliderMin.max = 100;
    sliderMax.max = 100;
    sliderMin.value = startPct;
    sliderMax.value = 100;

    function updateLabels() {
        const lo = parseInt(sliderMin.value);
        const hi = parseInt(sliderMax.value);
        const startIdx = Math.floor(lo / 100 * totalLen);
        const endIdx = Math.min(totalLen - 1, Math.ceil(hi / 100 * totalLen));
        if (dateStart) dateStart.textContent = formatFullDate(allHistory[Math.max(0, startIdx)]?.played_at);
        if (dateEnd) dateEnd.textContent = formatFullDate(allHistory[Math.min(totalLen - 1, endIdx)]?.played_at);
    }
    updateLabels();

    function onSliderInput() {
        let lo = parseInt(sliderMin.value);
        let hi = parseInt(sliderMax.value);
        // Prevent crossing
        if (lo >= hi) {
            if (this === sliderMin) lo = hi - 1;
            else hi = lo + 1;
            sliderMin.value = lo;
            sliderMax.value = hi;
        }
        updateLabels();

        const startIdx = Math.floor(lo / 100 * totalLen);
        const endIdx = Math.ceil(hi / 100 * totalLen);
        const sliced = allHistory.slice(Math.max(0, startIdx), Math.min(totalLen, endIdx));

        if (chart && sliced.length > 1) {
            const labels = sliced.map(h => formatShortDate(h.played_at));
            const values = sliced.map(h => h.our_rating || 0);
            const maxV = Math.max(...values);
            const minV = Math.min(...values.filter(v => v > 0));
            const pad = 50;

            chart.data.labels = labels;
            chart.data.datasets[0].data = values;
            chart.options.scales.y.min = Math.max(0, minV - pad);
            chart.options.scales.y.max = maxV + pad;
            chart._ratingRawValues = values;
            chart._ratingHistory = sliced;
            chart.update('none');
        }

        // Deactivate period buttons
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('btn-active'));
    }

    sliderMin.addEventListener('input', onSliderInput);
    sliderMax.addEventListener('input', onSliderInput);

    // Store references for tooltip access
    chart._ratingRawValues = rawValues;
    chart._ratingHistory = visibleHistory;

    _rangeSliderCleanup = () => {
        sliderMin.removeEventListener('input', onSliderInput);
        sliderMax.removeEventListener('input', onSliderInput);
    };
}

// ─── Recent games (10 miniatures) ─────────────────────────────────────────────
function renderRecentGames(games) {
    const el = document.getElementById('recent-games-list');
    if (!el || !games.length) {
        if (el) el.innerHTML = `<p class="opacity-60 text-sm">${t('dashboard.noGames')}</p>`;
        return;
    }

    const showCheater = getUser()?.show_cheater_flag;
    el.innerHTML = games.slice(0, 10).map(g => {
        const isWin = g.result === '1-0' && g.our_color === 'w' || g.result === '0-1' && g.our_color === 'b';
        const isLoss = g.result === '0-1' && g.our_color === 'w' || g.result === '1-0' && g.our_color === 'b';
        const resultClass = isWin ? 'res-win' : isLoss ? 'res-loss' : 'res-draw';
        const resultIcon = isWin ? '+' : isLoss ? '-' : '=';
        const resultLabel = isWin ? t('dashboard.win') : isLoss ? t('dashboard.loss') : t('dashboard.draw');
        const accDisplay = g.accuracy_pct != null ? `${g.accuracy_pct}%` : '';
        const isCheater = showCheater && g.opponent_tos;
        const cheaterCls = isCheater ? ' cheater-flag' : '';
        const cheaterTooltip = isCheater ? ` data-cheater-tooltip="${t('live.cheaterFlag').replace(/"/g, '&quot;')}"` : '';

        return `
            <a href="#review/${g.id}" class="game-row ${resultClass}">
                <div class="game-result-badge ${resultClass}">${resultIcon}</div>
                <div class="game-info">
                    <div class="game-opponent${cheaterCls}"${cheaterTooltip}>vs ${escapeHtml(g.opponent) || '?'}</div>
                    <div class="game-details">${escapeHtml(g.opening_name) || t('dashboard.unknownOpening')}${g.time_control ? ' · ' + escapeHtml(g.time_control) : ''}${g.played_at && window.formatPlayedAt ? ' · ' + window.formatPlayedAt(g.played_at) : ''}</div>
                </div>
                <div class="game-meta">
                    <div class="game-result-label">${resultLabel}</div>
                    ${accDisplay ? `<div class="game-accuracy">${accDisplay}</div>` : ''}
                </div>
            </a>
        `;
    }).join('');
}

// ─── Top 5 Openings with winrate bars ─────────────────────────────────────────
function renderTopOpenings(openings) {
    const el = document.getElementById('top-openings-list');
    if (!el) return;
    if (!openings || !openings.length) {
        el.innerHTML = `<p class="opacity-60 text-sm">${t('dashboard.noOpenings')}</p>`;
        return;
    }

    el.innerHTML = openings.map(o => {
        const winPct = o.winrate || 0;
        const lossPct = o.games > 0 ? Math.round((o.losses || 0) / o.games * 100) : 0;
        const drawPct = 100 - winPct - lossPct;
        const fenAttr = o.opening_fen ? ` data-fen="${o.opening_fen}"` : '';
        const movesAttr = o.opening_moves?.length ? ` data-opening-moves="${o.opening_moves.join(',')}"` : '';

        return `
            <div class="flex items-center gap-3 py-2 border-b border-base-300 last:border-0 opening-cell"${fenAttr}${movesAttr}>
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium truncate">${o.opening_name || '?'}</div>
                    <div class="text-xs opacity-60">
                        ${o.opening_eco ? `<span class="badge badge-ghost badge-xs mr-1">${o.opening_eco}</span>` : ''}${o.games} ${t('dashboard.games')}
                    </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <div class="opening-bar w-20">
                        <div class="ob-win" style="width:${winPct}%"></div>
                        <div class="ob-draw" style="width:${drawPct}%"></div>
                        <div class="ob-loss" style="width:${lossPct}%"></div>
                    </div>
                    <span class="text-sm font-semibold w-10 text-right">${winPct}%</span>
                </div>
            </div>
        `;
    }).join('');
}

// ─── All openings (existing) ──────────────────────────────────────────────────
function renderOpenings(openings) {
    const el = document.getElementById('openings-list');
    if (!el || !openings.length) {
        if (el) el.innerHTML = `<p class="opacity-60 text-sm">${t('dashboard.noOpenings')}</p>`;
        return;
    }

    el.innerHTML = openings.slice(0, 8).map(o => {
        const total = o.games || 1;
        const winPct = Math.round((o.wins || 0) / total * 100);
        const lossPct = Math.round((o.losses || 0) / total * 100);
        const drawPct = 100 - winPct - lossPct;
        const fenAttr = o.opening_fen ? ` data-fen="${o.opening_fen}"` : '';
        const movesAttr = o.opening_moves?.length ? ` data-opening-moves="${o.opening_moves.join(',')}"` : '';

        return `
            <div class="opening-row opening-cell"${fenAttr}${movesAttr}>
                <div class="opening-info">
                    <div class="opening-name">${o.opening_name || '?'}</div>
                    <div class="opening-eco">${o.opening_eco ? `<span class="badge badge-ghost badge-xs">${o.opening_eco}</span> ` : ''}${o.games} ${t('dashboard.games')}</div>
                </div>
                <div class="opening-bar">
                    <div class="ob-win" style="width:${winPct}%"></div>
                    <div class="ob-draw" style="width:${drawPct}%"></div>
                    <div class="ob-loss" style="width:${lossPct}%"></div>
                </div>
                <div class="opening-score">${winPct}%</div>
            </div>
        `;
    }).join('');
}

// ─── Opening hover preview (animated mini-board) ─────────────────────────────
let _dashAnimId = 0;
let _dashCgModule = null;
let _dashPreviewGround = null;

function attachDashOpeningHover() {
    const previewEl = document.getElementById('dash-opening-preview');
    if (!previewEl) return;

    document.querySelectorAll('.dash-grid .opening-cell[data-fen]').forEach(cell => {
        cell.addEventListener('mouseenter', async () => {
            const fen = cell.dataset.fen;
            if (!fen) return;

            const animId = ++_dashAnimId;

            const rect = cell.getBoundingClientRect();
            const spaceRight = window.innerWidth - rect.right;
            if (spaceRight >= 220) {
                previewEl.style.left = (rect.right + 8) + 'px';
                previewEl.style.top = rect.top + 'px';
            } else {
                previewEl.style.left = rect.left + 'px';
                previewEl.style.top = (rect.bottom + 4) + 'px';
            }

            const boardEl = document.getElementById('dash-opening-preview-board');
            if (!boardEl) return;

            if (!_dashCgModule) {
                _dashCgModule = await import('/static/vendor/chessground.min.js');
            }
            if (animId !== _dashAnimId) return;
            const { Chessground } = _dashCgModule;

            const movesRaw = cell.dataset.openingMoves;
            const moves = movesRaw ? movesRaw.split(',') : [];
            const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

            if (_dashPreviewGround) {
                _dashPreviewGround.set({ fen: startFen, viewOnly: true, lastMove: undefined });
            } else {
                _dashPreviewGround = Chessground(boardEl, {
                    fen: startFen, viewOnly: true, coordinates: false,
                    animation: { enabled: true, duration: 300 },
                });
            }

            previewEl.classList.add('visible');

            if (moves.length > 0 && window.Chess) {
                const chess = new Chess();
                for (let i = 0; i < moves.length; i++) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                    if (animId !== _dashAnimId) return;
                    const uci = moves[i];
                    const from = uci.slice(0, 2);
                    const to = uci.slice(2, 4);
                    const promo = uci.length > 4 ? uci[4] : undefined;
                    const result = chess.move({ from, to, promotion: promo });
                    if (result) {
                        _dashPreviewGround.set({ fen: chess.fen(), lastMove: [from, to] });
                    }
                }
            } else if (fen) {
                _dashPreviewGround.set({ fen, viewOnly: true, lastMove: undefined });
            }
        });

        cell.addEventListener('mouseleave', () => {
            _dashAnimId++;
            previewEl.classList.remove('visible');
        });
    });
}
