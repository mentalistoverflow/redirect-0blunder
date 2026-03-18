/**
 * Live page — real-time game board + eval bar + coaching comments.
 * New game panel, challenge notifications, live stats, game-over review link.
 *
 * ─── Noctie Compatibility ───────────────────────────────────────────────
 * This board is configured for compatibility with Noctie (companion app in
 * ../noctie/) which captures the screen via GDI and uses a CNN to detect
 * the board and recognize pieces. Key configuration choices:
 *
 * - Piece set: cburnett (standard Lichess SVG pieces via chessground.cburnett.css).
 *   High-contrast black/white outlines, ideal for CNN recognition.
 * - Board theme: brown (chessground.brown.css) — #f0d9b5 / #b58863 squares,
 *   strong contrast for edge detection.
 * - Coordinates: external (ranksPosition: 'left', margin-left: 24px,
 *   margin-bottom: 26px in CSS). Coordinates are outside the board area,
 *   so they do not overlay or occlude pieces.
 * - Overlays: no permanent overlays. last-move and check highlights are
 *   temporary translucent backgrounds on squares. Shapes layer (arrows)
 *   is user-initiated and temporary.
 * - Board sizing: stable layout via aspect-ratio: 1/1 and explicit
 *   width/height from calc(). No layout shifts (CLS) during gameplay.
 *   The board-core container uses flex:none to prevent resizing.
 * - Player bars (name + clock) are outside the board area (above/below),
 *   so they do not interfere with board detection.
 *
 * See frontend/NOCTIE.md for detailed Noctie configuration recommendations.
 * ────────────────────────────────────────────────────────────────────────
 */

import { Chessground } from '/static/vendor/chessground.min.js';
import { Chess } from '/static/vendor/chess.min.js';
import { EvalBar } from './eval-bar.js';
import { wsClient } from './websocket.js';
import { t } from './i18n.js';
import { apiFetch } from './api.js';
import { isFreeUser } from './user-state.js';
import { showGameModal, updateGameSummary, hideGameModal } from './components/game-modal.js';
import { showGameEndOverlay, clearGameEndOverlay } from './components/game-end-overlay.js';

let ground = null;
let evalBar = null;
let chess = null;
let currentGameId = null;
let dbGameId = null;
let moves = [];
let ourColor = 'w';
let opponentName = '';
let isConnected = false;
let hasLichessToken = false;
let gameInProgress = false;
let isSeeking = false;
let seekingTimeControl = '';
let gameOverData = null;
let newGamePanelOpen = false;
let viewIndex = -1; // -1 = live (latest position), 0+ = viewing specific move
let moveInFlight = false;     // true while waiting for server move response
let preMovefen = null;        // FEN before our local move (for safe rollback)

// Spectating state
let isSpectating = false;
let spectatorsBlocked = false;
let _spectateKickedMsg = null; // set when spectator is kicked, shown after backToLobby
let spectatingWhiteName = '';
let spectatingBlackName = '';
let spectatingWhiteRating = null;
let spectatingBlackRating = null;

// Live stats accumulators
let stats = { accuracy: [], brilliants: 0, greats: 0, blunders: 0, mistakes: 0, inaccuracies: 0, ourMoves: 0 };
// Spectating: separate stats per color
let whiteStats = { accuracy: [], brilliants: 0, greats: 0, blunders: 0, mistakes: 0, inaccuracies: 0, moves: 0 };
let blackStats = { accuracy: [], brilliants: 0, greats: 0, blunders: 0, mistakes: 0, inaccuracies: 0, moves: 0 };

// New game form state
let selectedTime = { time: 5, increment: 3 };
let selectedMode = 'seek'; // 'seek' | 'challenge'
let selectedRated = false;
let selectedColor = 'random';
let challengeUsername = '';

// Pending challenges
let pendingChallenges = new Map();

// Toggle states
let coachEnabled = false;    // OFF by default each game
let evalBarEnabled = true;   // from DB preference
let statsEnabled = true;     // ON by default each game
let boardFullscreen = false;

// Friends refresh interval (60s)
let friendsRefreshInterval = null;

// Clock state
let clockWhite = 0;          // ms remaining
let clockBlack = 0;          // ms remaining
let clockIncrement = 0;      // ms
let clockActive = null;      // 'w' or 'b' — whose clock is ticking
let clockLastTick = 0;       // timestamp of last tick
let clockInterval = null;    // interval ID
let ourUsername = '';
let showCheaterFlag = false;

export async function render(container) {
    // Check if user has Lichess token + load preferences
    try {
        const resp = await fetch('/api/auth/me');
        if (resp.ok) {
            const user = await resp.json();
            hasLichessToken = user.has_lichess_token;
            evalBarEnabled = user.live_eval_bar !== false;
            statsEnabled = user.live_stats !== false;
            showCheaterFlag = !!user.show_cheater_flag;
            ourUsername = user.lichess_username || user.username || '';
            // Restore lobby preferences
            if (user.live_preferences) {
                const p = user.live_preferences;
                selectedTime = { time: p.time ?? 5, increment: p.increment ?? 3 };
                selectedMode = p.mode || 'seek';
                selectedRated = !!p.rated;
                selectedColor = p.color || 'random';
            }
        }
    } catch { /* ignore */ }

    if (!hasLichessToken) {
        renderNoToken(container);
        return;
    }

    renderMainLayout(container);
    setupBoard();
    setupListeners();
    loadPendingChallenges();
}

export function destroy() {
    wsClient.off('connected', onConnected);
    wsClient.off('disconnected', onDisconnected);
    wsClient.off('game_start', onGameStart);
    wsClient.off('game_clock', onGameClock);
    wsClient.off('move_played', onMovePlayed);
    wsClient.off('move_eval', onMoveEval);
    wsClient.off('move_comment', onMoveComment);
    wsClient.off('game_over', onGameOver);
    wsClient.off('game_summary', onGameSummary);
    wsClient.off('challenge_incoming', onChallengeIncoming);
    wsClient.off('challenge_sent', onChallengeSent);
    wsClient.off('challenge_canceled', onChallengeCanceled);
    wsClient.off('challenge_declined', onChallengeDeclined);
    wsClient.off('seeking', onSeeking);
    wsClient.off('seek_ended', onSeekEnded);
    wsClient.off('seek_canceled', onSeekCanceled);
    wsClient.off('seek_color_fallback', onSeekColorFallback);
    wsClient.off('spectate_start', onSpectateStart);
    wsClient.off('spectate_ended', onSpectateEnded);
    wsClient.off('spectate_stopped', onSpectateStopped);
    wsClient.off('spectator_count', onSpectatorCount);
    wsClient.off('spectators_blocked', onSpectatorsBlocked);
    wsClient.off('spectate_kicked', onSpectateKicked);
    window.removeEventListener('route-reclick', onRouteReclick);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onOrientationChange);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    stopClock();
    // Remove body scroll lock
    setLiveGameActive(false);
    // Exit native fullscreen if active
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
    // Exit CSS fullscreen if active
    if (boardFullscreen) {
        boardFullscreen = false;
        const layout = document.getElementById('live-layout');
        if (layout) layout.classList.remove('board-fullscreen');
    }
    if (ground) {
        ground.destroy();
        ground = null;
    }
    // Stop spectating on the backend if we're currently spectating
    if (isSpectating) {
        apiFetch('/api/live/spectate-stop', { method: 'POST' }).catch(() => {});
    }
    isSpectating = false;
    pendingChallenges.clear();
    hideGameModal();
    if (friendsRefreshInterval) {
        clearInterval(friendsRefreshInterval);
        friendsRefreshInterval = null;
    }
}

// ─── Render helpers ──────────────────────────────────────────────

function renderNoToken(container) {
    container.innerHTML = `
        <div class="card bg-base-200 max-w-md mx-auto mt-12">
            <div class="card-body items-center text-center gap-4">
                <svg class="w-12 h-12 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4m0 4h.01"/>
                </svg>
                <p class="text-base-content/70">${t('live.noToken')}</p>
                <button class="btn btn-primary" id="btn-go-settings">${t('live.goToSettings')}</button>
            </div>
        </div>
    `;
    container.querySelector('#btn-go-settings')?.addEventListener('click', () => {
        location.hash = '#settings';
    });
}

function renderMainLayout(container) {
    container.innerHTML = `
        <div id="live-challenges"></div>

        <div class="navbar bg-base-200 rounded-box px-4 gap-2 live-header" id="live-header" style="display:none">
            <span class="badge ${isConnected ? 'badge-success' : 'badge-error'} badge-xs" id="live-status" aria-hidden="true"></span>
            <span class="live-status-text text-sm" id="live-status-text" role="status" aria-live="polite">${t('live.disconnected')}</span>
            <span class="live-opponent-info text-sm font-semibold" id="live-opponent-info" aria-live="polite"></span>
            <button class="btn btn-ghost btn-xs spectator-eye-btn" id="spectator-count-badge" style="display:none" aria-live="polite" title="${t('live.toggleSpectators')}"></button>
            <div class="flex-1"></div>
            <div class="live-actions flex gap-1" id="live-actions">
                ${!isFreeUser() ? `<div class="tooltip tooltip-bottom" data-tip="${t('live.showCoach')}">
                    <button class="btn btn-ghost btn-sm btn-square live-toolbar-btn" id="btn-toggle-coach" aria-label="${t('live.showCoach')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </button>
                </div>` : ''}
                <div class="tooltip tooltip-bottom" data-tip="${evalBarEnabled ? t('live.hideEvalBar') : t('live.showEvalBar')}">
                    <button class="btn btn-ghost btn-sm btn-square live-toolbar-btn ${evalBarEnabled ? 'active' : ''}" id="btn-toggle-eval" aria-label="${evalBarEnabled ? t('live.hideEvalBar') : t('live.showEvalBar')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5" aria-hidden="true"><rect x="3" y="3" width="4" height="18" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="17" y="1" width="4" height="20" rx="1"/></svg>
                    </button>
                </div>
                <div class="tooltip tooltip-bottom" data-tip="${statsEnabled ? t('live.hideStats') : t('live.showStats')}">
                    <button class="btn btn-ghost btn-sm btn-square live-toolbar-btn ${statsEnabled ? 'active' : ''}" id="btn-toggle-stats" aria-label="${statsEnabled ? t('live.hideStats') : t('live.showStats')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5" aria-hidden="true"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
                    </button>
                </div>
                <div class="tooltip tooltip-bottom" data-tip="${t('live.fullscreen')}">
                    <button class="btn btn-ghost btn-sm btn-square live-toolbar-btn" id="btn-toggle-fullscreen" aria-label="${t('live.fullscreen')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                    </button>
                </div>
                <div class="tooltip tooltip-bottom" data-tip="${t('live.viewOnLichess')}">
                    <a class="btn btn-ghost btn-sm btn-square live-toolbar-btn" id="btn-lichess-link" href="#" target="_blank" rel="noopener" style="display:none">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                </div>
            </div>
        </div>

        <div id="live-lobby"></div>
        <div id="live-ongoing-games"></div>

        <div id="live-game-area" style="display:none">
            <div class="live-layout ${evalBarEnabled ? '' : 'eval-bar-hidden'}" id="live-layout">
                <button class="fullscreen-exit-btn" id="btn-exit-fullscreen" title="${t('live.exitFullscreen')}" aria-label="${t('live.exitFullscreen')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="21" y2="3"/><line x1="3" y1="21" x2="14" y2="10"/></svg>
                </button>
                <div class="live-panel-left" id="live-panel-left">
                    <div class="panel-section" id="live-stats-section" style="display:none">
                        <h4 class="text-sm font-semibold opacity-70 mb-2">${t('live.liveStats')}</h4>
                        <div class="live-stats" id="live-stats"></div>
                    </div>
                </div>
                <div class="board-column">
                    <div class="board-with-eval">
                        <div class="eval-bar-container" id="live-eval-bar"></div>
                        <div class="board-core">
                            <div class="board-player-bar bg-base-300 rounded-lg" id="player-bar-top" aria-label="${t('live.opponentBar')}">
                                <span class="player-name" id="player-name-top"></span>
                                <span class="player-clock" id="clock-top" role="timer" aria-live="off" aria-label="${t('live.opponentClock')}">--:--</span>
                            </div>
                            <div class="cg-wrap" id="live-board" aria-label="${t('live.chessBoard')}" role="img"></div>
                            <div class="board-player-bar bg-base-300 rounded-lg" id="player-bar-bottom" aria-label="${t('live.playerBar')}">
                                <span class="player-name" id="player-name-bottom"></span>
                                <span class="player-clock" id="clock-bottom" role="timer" aria-live="off" aria-label="${t('live.playerClock')}">--:--</span>
                            </div>
                        </div>
                    </div>
                    <div class="game-actions" id="game-actions" style="display:none">
                        <button class="btn btn-ghost btn-sm game-action-btn btn-abort" id="btn-abort" title="${t('live.abort')}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                            ${t('live.abort')}
                        </button>
                        <button class="btn btn-warning btn-sm btn-outline game-action-btn" id="btn-offer-draw" title="${t('live.offerDraw')}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M8 6v12M16 6v12M4 12h16"/></svg>
                            ${t('live.offerDraw')}
                        </button>
                        <span style="flex:1"></span>
                        <button class="btn btn-error btn-sm btn-outline game-action-btn btn-resign" id="btn-resign" title="${t('live.resign')}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                            ${t('live.resign')}
                        </button>
                    </div>
                </div>
                <div class="live-panel-right" id="live-panel-right">
                    <div class="move-list" id="live-moves" aria-label="${t('live.moveList')}" role="log"></div>
                    <div class="join move-nav" id="move-nav" role="toolbar" aria-label="${t('live.moveNavigation')}">
                        <button class="btn btn-ghost btn-xs join-item move-nav-btn" id="btn-move-first" title="${t('live.firstMove')}">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.41 16.59L13.82 12l4.59-4.59L17 6l-6 6 6 6 1.41-1.41zM6 6h2v12H6V6z"/></svg>
                        </button>
                        <button class="btn btn-ghost btn-xs join-item move-nav-btn" id="btn-move-prev" title="${t('live.prevMove')}">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>
                        </button>
                        <button class="btn btn-ghost btn-xs join-item move-nav-btn" id="btn-move-next" title="${t('live.nextMove')}">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
                        </button>
                        <button class="btn btn-ghost btn-xs join-item move-nav-btn" id="btn-move-last" title="${t('live.lastMove')}">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M5.59 7.41L10.18 12l-4.59 4.59L7 18l6-6-6-6-1.41 1.41zM16 6h2v12h-2V6z"/></svg>
                        </button>
                        <button class="btn btn-ghost btn-xs join-item move-nav-btn" id="btn-flip-board" title="${t('live.flipBoard')}">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
                        </button>
                    </div>
                    <div id="live-game-over-container" aria-live="polite"></div>
                </div>
            </div>
        </div>
    `;
}

function setupBoard() {
    const boardEl = document.getElementById('live-board');
    if (!boardEl) return;
    clearGameEndOverlay(boardEl);
    ground = Chessground(boardEl, {
        orientation: 'white',
        coordinates: true,
        ranksPosition: 'left',
        animation: { duration: 120 },
        movable: {
            free: false,
            color: 'white',
            showDests: true,
            dests: new Map(),
            events: { after: onBoardMove },
        },
        premovable: { enabled: true },
        draggable: { enabled: true },
    });
    evalBar = new EvalBar(document.getElementById('live-eval-bar'));
    chess = new Chess();
    moves = [];
    resetStats();
}

function setupListeners() {
    wsClient.on('connected', onConnected);
    wsClient.on('disconnected', onDisconnected);
    wsClient.on('game_start', onGameStart);
    wsClient.on('game_clock', onGameClock);
    wsClient.on('move_played', onMovePlayed);
    wsClient.on('move_eval', onMoveEval);
    wsClient.on('move_comment', onMoveComment);
    wsClient.on('game_over', onGameOver);
    wsClient.on('game_summary', onGameSummary);
    wsClient.on('challenge_incoming', onChallengeIncoming);
    wsClient.on('challenge_sent', onChallengeSent);
    wsClient.on('challenge_canceled', onChallengeCanceled);
    wsClient.on('challenge_declined', onChallengeDeclined);
    wsClient.on('seeking', onSeeking);
    wsClient.on('seek_ended', onSeekEnded);
    wsClient.on('seek_canceled', onSeekCanceled);
    wsClient.on('seek_color_fallback', onSeekColorFallback);
    wsClient.on('spectate_start', onSpectateStart);
    wsClient.on('spectate_ended', onSpectateEnded);
    wsClient.on('spectate_stopped', onSpectateStopped);
    wsClient.on('spectator_count', onSpectatorCount);
    wsClient.on('spectators_blocked', onSpectatorsBlocked);
    wsClient.on('spectate_kicked', onSpectateKicked);

    // Sidebar re-click: return to lobby
    window.addEventListener('route-reclick', onRouteReclick);

    // Toolbar toggles
    document.getElementById('spectator-count-badge')?.addEventListener('click', onToggleSpectatorsBlock);
    document.getElementById('btn-toggle-coach')?.addEventListener('click', toggleCoach);
    document.getElementById('btn-toggle-eval')?.addEventListener('click', toggleEvalBar);
    document.getElementById('btn-toggle-stats')?.addEventListener('click', toggleStats);
    document.getElementById('btn-toggle-fullscreen')?.addEventListener('click', toggleFullscreen);
    document.getElementById('btn-exit-fullscreen')?.addEventListener('click', toggleFullscreen);

    // Game action buttons
    document.getElementById('btn-resign')?.addEventListener('click', onResignClick);
    document.getElementById('btn-offer-draw')?.addEventListener('click', onOfferDrawClick);
    document.getElementById('btn-abort')?.addEventListener('click', onAbortClick);

    // Move navigation buttons
    document.getElementById('btn-move-first')?.addEventListener('click', () => navigateMove('first'));
    document.getElementById('btn-move-prev')?.addEventListener('click', () => navigateMove('prev'));
    document.getElementById('btn-move-next')?.addEventListener('click', () => navigateMove('next'));
    document.getElementById('btn-move-last')?.addEventListener('click', () => navigateMove('last'));
    document.getElementById('btn-flip-board')?.addEventListener('click', flipBoard);

    // Escape key exits fullscreen
    document.addEventListener('keydown', onKeyDown);

    // Resize / orientation change → redraw board
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrientationChange);

    // Sync fullscreen state when native fullscreen changes
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    // If WS already connected
    if (wsClient.ws && wsClient.ws.readyState === WebSocket.OPEN) {
        onConnected();
    }

    // Show lobby directly, then check if already seeking/playing
    renderLobby();
    fetchOngoingGames();
    checkLiveStatus();
}

// ─── Mobile resize handling ──────────────────────────────────────

function onResize() {
    if (ground) {
        ground.redrawAll();
    }
}

function onOrientationChange() {
    // Delay redraw to let the browser settle after rotation
    setTimeout(() => {
        if (ground) ground.redrawAll();
    }, 200);
}

function setLiveGameActive(active) {
    if (active) {
        document.body.classList.add('live-game-active');
    } else {
        document.body.classList.remove('live-game-active');
    }
}

// ─── Lobby (main view when not in game) ─────────────────────────

// Friends panel state
let friendsScopeBlocked = false;
let friendsSearchTimeout = null;

function renderLobby() {
    const container = document.getElementById('live-lobby');
    if (!container) return;

    const presets = [
        { cat: 'live.bullet', icon: '\u26A1', items: [{ l: '1+0', t: 1, i: 0 }, { l: '2+1', t: 2, i: 1 }] },
        { cat: 'live.blitz', icon: '\uD83D\uDD25', items: [{ l: '3+0', t: 3, i: 0 }, { l: '3+2', t: 3, i: 2 }, { l: '5+0', t: 5, i: 0 }, { l: '5+3', t: 5, i: 3 }] },
        { cat: 'live.rapid', icon: '\uD83D\uDD50', items: [{ l: '10+0', t: 10, i: 0 }, { l: '10+5', t: 10, i: 5 }, { l: '15+10', t: 15, i: 10 }] },
    ];

    let presetsHtml = '';
    for (const g of presets) {
        presetsHtml += `<div class="lobby-preset-group"><span class="lobby-preset-label">${g.icon} ${t(g.cat)}</span>`;
        for (const p of g.items) {
            const active = (selectedTime.time === p.t && selectedTime.increment === p.i) ? 'btn-active' : '';
            presetsHtml += `<button class="btn btn-outline btn-sm time-preset ${active}" data-time="${p.t}" data-inc="${p.i}">${p.l}</button>`;
        }
        presetsHtml += `</div>`;
    }

    container.innerHTML = `
        <div class="live-lobby-wrapper">
            <div class="live-lobby">
                <div class="live-lobby-header">
                    <h2>${t('live.lobbyTitle')}</h2>
                    <p class="live-lobby-subtitle">${t('live.lobbySubtitle')}</p>
                </div>

                <div class="live-lobby-body">
                    <div class="lobby-presets-grid">${presetsHtml}</div>

                    <div class="lobby-custom-row">
                        <span class="lobby-preset-label">\u2699\uFE0F ${t('live.custom')}</span>
                        <input type="number" id="custom-time" class="input input-bordered input-sm lobby-custom-input" min="0.5" max="180" step="0.5" value="${selectedTime.time}" />
                        <span class="lobby-custom-unit">${t('live.minutes')}</span>
                        <input type="number" id="custom-inc" class="input input-bordered input-sm lobby-custom-input" min="0" max="180" step="1" value="${selectedTime.increment}" />
                        <span class="lobby-custom-unit">${t('live.increment')}</span>
                    </div>

                    <div class="lobby-options-row">
                        <div class="join">
                            <button class="btn btn-sm join-item ${selectedMode === 'seek' ? 'btn-active' : ''}" data-mode="seek">${t('live.seek')}</button>
                            <button class="btn btn-sm join-item ${selectedMode === 'challenge' ? 'btn-active' : ''}" data-mode="challenge">${t('live.challenge')}</button>
                        </div>
                        <div class="join">
                            <button class="btn btn-sm join-item ${!selectedRated ? 'btn-active' : ''}" data-rated="false">${t('live.casual')}</button>
                            <button class="btn btn-sm join-item ${selectedRated ? 'btn-active' : ''}" data-rated="true">${t('live.rated')}</button>
                        </div>
                        <div class="join">
                            <button class="btn btn-sm join-item ${selectedColor === 'random' ? 'btn-active' : ''}" data-color="random">${t('live.colorRandom')}</button>
                            <button class="btn btn-sm join-item ${selectedColor === 'white' ? 'btn-active' : ''}" data-color="white">${t('live.colorWhite')}</button>
                            <button class="btn btn-sm join-item ${selectedColor === 'black' ? 'btn-active' : ''}" data-color="black">${t('live.colorBlack')}</button>
                        </div>
                    </div>

                    <div id="challenge-username-row" class="lobby-challenge-row" style="display:${selectedMode === 'challenge' ? '' : 'none'}">
                        <input class="input input-bordered input-sm" type="text" id="challenge-username"
                               placeholder="${t('live.usernamePlaceholder')}" value="${escapeAttr(challengeUsername)}" style="flex:1" />
                    </div>

                    <button class="btn btn-primary w-full" id="btn-launch">${t('live.launch')}</button>
                </div>
            </div>

            <div class="friends-panel" id="friends-panel">
                <div class="friends-panel-header">
                    <h3>${t('live.friendsPanel')}</h3>
                    <span class="badge badge-neutral badge-sm" id="friends-count">0</span>
                </div>
                <div class="friends-search" id="friends-search">
                    <input class="input input-bordered input-sm w-full" type="text" id="friends-search-input"
                           placeholder="${t('live.searchUsers')}" autocomplete="off" />
                    <div class="friends-autocomplete-dropdown" id="friends-autocomplete" style="display:none"></div>
                </div>
                <div class="friends-scope-warning" id="friends-scope-warning" style="display:none">
                    ${t('live.followScopeWarning')}
                </div>
                <div class="friends-list" id="friends-list">
                    <div class="friends-empty">${t('live.noFriends')}</div>
                </div>
            </div>
        </div>
    `;

    bindLobbyEvents(container);
    updateSeekAvailability(container);
    loadFriendsPanel(!friendsRatingsLoaded);  // First load fetches ratings, subsequent don't
    setupFriendsSearch();

    // Refresh friends status every 15s for near-real-time updates
    if (friendsRefreshInterval) clearInterval(friendsRefreshInterval);
    friendsRefreshInterval = setInterval(loadFriendsPanel, 15_000);
}

function isSeekableTimeControl() {
    return selectedTime.time * 60 + selectedTime.increment * 40 >= 480;
}

function updateSeekAvailability(container) {
    const seekBtn = container.querySelector('[data-mode="seek"]');
    if (!seekBtn) return;
    const seekable = isSeekableTimeControl();

    seekBtn.disabled = !seekable;
    seekBtn.classList.toggle('btn-disabled', !seekable);
    seekBtn.title = seekable ? '' : t('live.seekRapidOnly');

    if (!seekable && selectedMode === 'seek') {
        selectedMode = 'challenge';
        container.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('btn-active'));
        container.querySelector('[data-mode="challenge"]')?.classList.add('btn-active');
        const row = document.getElementById('challenge-username-row');
        if (row) row.style.display = '';
    }
}

function bindLobbyEvents(container) {
    container.querySelectorAll('.time-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedTime = { time: parseFloat(btn.dataset.time), increment: parseInt(btn.dataset.inc) };
            document.getElementById('custom-time').value = selectedTime.time;
            document.getElementById('custom-inc').value = selectedTime.increment;
            container.querySelectorAll('.time-preset').forEach(b => b.classList.remove('btn-active'));
            btn.classList.add('btn-active');
            updateSeekAvailability(container);
        });
    });

    document.getElementById('custom-time')?.addEventListener('change', (e) => {
        selectedTime.time = parseFloat(e.target.value) || 5;
        container.querySelectorAll('.time-preset').forEach(b => b.classList.remove('btn-active'));
        updateSeekAvailability(container);
    });
    document.getElementById('custom-inc')?.addEventListener('change', (e) => {
        selectedTime.increment = parseInt(e.target.value) || 0;
        container.querySelectorAll('.time-preset').forEach(b => b.classList.remove('btn-active'));
        updateSeekAvailability(container);
    });

    container.querySelectorAll('[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedMode = btn.dataset.mode;
            container.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('btn-active'));
            btn.classList.add('btn-active');
            const row = document.getElementById('challenge-username-row');
            if (row) row.style.display = selectedMode === 'challenge' ? '' : 'none';
        });
    });

    container.querySelectorAll('[data-rated]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedRated = btn.dataset.rated === 'true';
            container.querySelectorAll('[data-rated]').forEach(b => b.classList.remove('btn-active'));
            btn.classList.add('btn-active');
        });
    });

    container.querySelectorAll('[data-color]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedColor = btn.dataset.color;
            container.querySelectorAll('[data-color]').forEach(b => b.classList.remove('btn-active'));
            btn.classList.add('btn-active');
        });
    });

    document.getElementById('challenge-username')?.addEventListener('input', (e) => {
        challengeUsername = e.target.value;
    });

    document.getElementById('btn-launch')?.addEventListener('click', launchGame);
}

// ---------- Friends panel ----------

// Cache ratings + TOS flags so polling doesn't need to refetch them
let friendsRatingCache = {};
let friendsTosCache = {};
let friendsRatingsLoaded = false;

async function loadFriendsPanel(withRatings = false) {
    const listEl = document.getElementById('friends-list');
    const countEl = document.getElementById('friends-count');
    if (!listEl) return;

    try {
        const url = withRatings ? '/api/live/following?withRatings=true' : '/api/live/following';
        const resp = await fetch(url, { credentials: 'same-origin' });
        if (!resp.ok) return;
        const data = await resp.json();
        const users = data.users || [];

        // Update rating + TOS cache if ratings were fetched
        if (withRatings) {
            for (const u of users) {
                const key = u.username.toLowerCase();
                if (u.rating != null) friendsRatingCache[key] = u.rating;
                if (u.tosViolation) friendsTosCache[key] = true;
            }
            friendsRatingsLoaded = true;
        } else {
            // Merge cached ratings + TOS flags
            for (const u of users) {
                const key = u.username.toLowerCase();
                if (u.rating == null) {
                    u.rating = friendsRatingCache[key] || null;
                }
                if (!u.tosViolation && friendsTosCache[key]) {
                    u.tosViolation = true;
                }
            }
        }

        if (countEl) countEl.textContent = users.length;

        if (users.length === 0) {
            listEl.innerHTML = `<div class="friends-empty">${t('live.noFriends')}</div>`;
            return;
        }

        // Sort: playing > online > offline
        users.sort((a, b) => {
            const score = u => u.playing ? 2 : u.online ? 1 : 0;
            return score(b) - score(a);
        });

        listEl.innerHTML = users.map(u => renderFriendCard(u)).join('');
        bindFriendCardEvents(listEl);
    } catch (e) {
        console.warn('Failed to load friends:', e);
    }
}

const _friendProfileCache = {};

function renderFriendCard(user) {
    const dotCls = user.playing ? 'playing' : user.online ? 'online' : '';
    const statusText = user.playing ? t('live.friendPlaying') : user.online ? t('live.friendOnline') : t('live.friendOffline');
    const username = escapeHtml(user.username);
    const usernameAttr = escapeAttr(user.username);
    const isCheater = showCheaterFlag && user.tosViolation;
    const cheaterCls = isCheater ? ' cheater-flag' : '';
    const cheaterTooltip = isCheater ? ` data-cheater-tooltip="${t('live.cheaterFlag').replace(/"/g, '&quot;')}"` : '';
    return `
        <div class="friend-card" data-username="${usernameAttr}">
            <div class="friend-info">
                <span class="friend-dot ${dotCls}"></span>
                <span class="friend-username${cheaterCls}${user.playing ? ' friend-username-playing' : ''}"${cheaterTooltip}>${username}</span>
                <span class="friend-status-text">${statusText}</span>
            </div>
            <div class="friend-actions">
                ${user.playing ? `<button class="btn btn-ghost btn-xs friend-watch-btn" data-username="${usernameAttr}" title="${t('live.watchGame')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>` : ''}
            </div>
            <div class="friend-hover-overlay">
                <div class="friend-overlay-icons">
                    <a href="https://lichess.org/@/${usernameAttr}" target="_blank" rel="noopener"
                       class="btn btn-ghost btn-xs" title="${t('friend.lichessProfile')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                    <a href="#friend/${usernameAttr}" class="btn btn-ghost btn-xs" title="${t('friend.viewProfile')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M16 8v8"/><path d="M12 11v5"/><path d="M8 14v2"/><path d="M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/></svg>
                    </a>
                    <button class="btn btn-ghost btn-xs friend-challenge-btn" title="${t('live.challengeFriend')}" data-username="${usernameAttr}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-xs friend-unfollow-btn" title="${t('live.unfollowFriend')}" data-username="${usernameAttr}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div class="friend-overlay-ratings" data-username="${usernameAttr}"></div>
            </div>
        </div>`;
}

function bindFriendCardEvents(container) {
    container.querySelectorAll('.friend-watch-btn').forEach(btn => {
        btn.addEventListener('click', () => startSpectating(btn.dataset.username));
    });
    container.querySelectorAll('.friend-username-playing').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
            const card = el.closest('.friend-card');
            if (card) startSpectating(card.dataset.username);
        });
    });
    container.querySelectorAll('.friend-challenge-btn').forEach(btn => {
        btn.addEventListener('click', () => onChallengeFromFriend(btn.dataset.username));
    });
    container.querySelectorAll('.friend-unfollow-btn').forEach(btn => {
        btn.addEventListener('click', () => onUnfollowFriend(btn.dataset.username, btn));
    });
    // Hover overlay: lazy-load ratings on first mouseenter
    container.querySelectorAll('.friend-card').forEach(card => {
        card.addEventListener('mouseenter', () => loadFriendRatings(card.dataset.username, card));
    });
}

async function loadFriendRatings(username, card) {
    const ratingsEl = card.querySelector('.friend-overlay-ratings');
    if (!ratingsEl || ratingsEl.dataset.loaded) return;
    ratingsEl.dataset.loaded = '1';
    if (_friendProfileCache[username]) {
        renderOverlayRatings(ratingsEl, _friendProfileCache[username]);
        return;
    }
    ratingsEl.textContent = '...';
    try {
        const resp = await apiFetch(`/api/friends/${encodeURIComponent(username)}/profile`);
        if (!resp.ok) throw new Error(resp.status);
        const data = await resp.json();
        _friendProfileCache[username] = data;
        renderOverlayRatings(ratingsEl, data);
    } catch {
        ratingsEl.textContent = '';
        ratingsEl.dataset.loaded = '';
    }
}

function renderOverlayRatings(el, profile) {
    const perfs = profile.perfs || {};
    const icons = { bullet: '\u26A1', blitz: '\uD83D\uDD25', rapid: '\uD83D\uDD50' };
    const parts = [];
    for (const cat of ['bullet', 'blitz', 'rapid']) {
        if (perfs[cat]) {
            parts.push(`<span>${icons[cat]} ${perfs[cat].rating}</span>`);
        }
    }
    el.innerHTML = parts.join('');
}

function onChallengeFromFriend(username) {
    challengeUsername = username;
    const input = document.getElementById('challenge-username');
    if (input) input.value = username;
    // Switch to challenge mode
    selectedMode = 'challenge';
    const wrapper = document.querySelector('.live-lobby-wrapper');
    if (wrapper) {
        wrapper.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('btn-active'));
        wrapper.querySelector('[data-mode="challenge"]')?.classList.add('btn-active');
    }
    const row = document.getElementById('challenge-username-row');
    if (row) row.style.display = '';
    // Scroll to launch button
    document.getElementById('btn-launch')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function onUnfollowFriend(username, btn) {
    // Confirmation phase: change button to confirm state for 3s
    if (!btn.dataset.confirming) {
        btn.dataset.confirming = 'true';
        btn.classList.add('btn-error');
        const originalTitle = btn.title;
        btn.title = t('live.confirmUnfollow');
        setTimeout(() => {
            if (btn.dataset.confirming) {
                delete btn.dataset.confirming;
                btn.classList.remove('btn-error');
                btn.title = originalTitle;
            }
        }, 3000);
        return;
    }

    delete btn.dataset.confirming;
    btn.disabled = true;

    try {
        const resp = await apiFetch(`/api/live/unfollow/${encodeURIComponent(username)}`, { method: 'POST' });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            if (err.detail && (err.detail.includes('403') || resp.status === 403)) {
                showFriendsScopeWarning();
                btn.disabled = false;
                return;
            }
            btn.disabled = false;
            return;
        }
        // Fade-out animation then remove
        const card = btn.closest('.friend-card');
        if (card) {
            card.classList.add('removing');
            setTimeout(() => {
                card.remove();
                // Update count
                const countEl = document.getElementById('friends-count');
                const listEl = document.getElementById('friends-list');
                if (countEl && listEl) {
                    const remaining = listEl.querySelectorAll('.friend-card').length;
                    countEl.textContent = remaining;
                    if (remaining === 0) {
                        listEl.innerHTML = `<div class="friends-empty">${t('live.noFriends')}</div>`;
                    }
                }
            }, 300);
        }
    } catch (e) {
        console.error('Unfollow error:', e);
        btn.disabled = false;
    }
}

async function onFollowUser(username, userStatus) {
    try {
        const resp = await apiFetch(`/api/live/follow/${encodeURIComponent(username)}`, { method: 'POST' });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            if (err.detail && (err.detail.includes('403') || resp.status === 403)) {
                showFriendsScopeWarning();
                return;
            }
            return;
        }
        // Optimistically add the friend card with the status we already know
        // (the /api/rel/following re-fetch may return stale online status)
        if (userStatus) {
            const listEl = document.getElementById('friends-list');
            const countEl = document.getElementById('friends-count');
            if (listEl) {
                // Remove "no friends" placeholder if present
                const empty = listEl.querySelector('.friends-empty');
                if (empty) empty.remove();
                // Add card at the top (online users first)
                const cardHtml = renderFriendCard({
                    username,
                    online: userStatus.online || false,
                    playing: userStatus.playing || false,
                });
                listEl.insertAdjacentHTML('afterbegin', cardHtml);
                const newCard = listEl.querySelector(`.friend-card[data-username="${escapeAttr(username)}"]`);
                if (newCard) bindFriendCardEvents(newCard);
                if (countEl) countEl.textContent = listEl.querySelectorAll('.friend-card').length;
            }
        } else {
            loadFriendsPanel();
        }
        // Clear search
        const input = document.getElementById('friends-search-input');
        if (input) input.value = '';
        hideFriendsAutocomplete();
    } catch (e) {
        console.error('Follow error:', e);
    }
}

function showFriendsScopeWarning() {
    friendsScopeBlocked = true;
    const warning = document.getElementById('friends-scope-warning');
    if (warning) warning.style.display = '';
}

function setupFriendsSearch() {
    const input = document.getElementById('friends-search-input');
    const dropdown = document.getElementById('friends-autocomplete');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        const term = input.value.trim();
        if (friendsSearchTimeout) clearTimeout(friendsSearchTimeout);

        if (term.length < 3) {
            if (term.length > 0) {
                dropdown.innerHTML = `<div class="friends-search-min">${t('live.searchMinChars')}</div>`;
                dropdown.style.display = '';
            } else {
                hideFriendsAutocomplete();
            }
            return;
        }

        friendsSearchTimeout = setTimeout(() => searchUsers(term), 300);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideFriendsAutocomplete();
            input.blur();
        }
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#friends-search')) {
            hideFriendsAutocomplete();
        }
    });
}

async function searchUsers(term) {
    const dropdown = document.getElementById('friends-autocomplete');
    if (!dropdown) return;

    try {
        const resp = await fetch(`/api/live/user-search?term=${encodeURIComponent(term)}`, { credentials: 'same-origin' });
        if (!resp.ok) return;
        const data = await resp.json();
        const results = data.results || [];

        if (results.length === 0) {
            dropdown.innerHTML = `<div class="friends-search-min">${t('live.noResults')}</div>`;
            dropdown.style.display = '';
            return;
        }

        // Get current friends to show "already following" state
        const currentFriends = new Set();
        document.querySelectorAll('#friends-list .friend-card').forEach(card => {
            currentFriends.add((card.dataset.username || '').toLowerCase());
        });

        dropdown.innerHTML = results.map(u => {
            const dotCls = u.playing ? 'playing' : u.online ? 'online' : '';
            const name = escapeHtml(u.name || u.id);
            const nameAttr = escapeAttr(u.name || u.id);
            const isFollowing = currentFriends.has((u.name || u.id).toLowerCase());
            const followBtn = isFollowing
                ? `<span class="badge badge-sm badge-ghost">${t('live.alreadyFollowing')}</span>`
                : `<button class="btn btn-ghost btn-xs autocomplete-follow-btn" data-username="${nameAttr}" data-online="${u.online ? '1' : ''}" data-playing="${u.playing ? '1' : ''}" title="${t('live.followUser')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                  </button>`;
            return `
                <div class="friends-autocomplete-item" data-username="${nameAttr}">
                    <span class="friend-dot ${dotCls}"></span>
                    <span class="autocomplete-name">${name}</span>
                    ${followBtn}
                </div>`;
        }).join('');

        dropdown.style.display = '';

        // Bind follow buttons
        dropdown.querySelectorAll('.autocomplete-follow-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                onFollowUser(btn.dataset.username, {
                    online: !!btn.dataset.online,
                    playing: !!btn.dataset.playing,
                });
            });
        });

        // Click on name → challenge
        dropdown.querySelectorAll('.friends-autocomplete-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.autocomplete-follow-btn') || e.target.closest('.badge')) return;
                onChallengeFromFriend(item.dataset.username);
                hideFriendsAutocomplete();
            });
        });
    } catch (e) {
        console.warn('User search error:', e);
    }
}

function hideFriendsAutocomplete() {
    const dropdown = document.getElementById('friends-autocomplete');
    if (dropdown) dropdown.style.display = 'none';
}

// ---------- Ongoing games ----------

async function fetchOngoingGames() {
    const container = document.getElementById('live-ongoing-games');
    if (!container) return;
    try {
        const resp = await fetch('/api/live/ongoing', { credentials: 'same-origin' });
        if (!resp.ok) { container.innerHTML = ''; return; }
        const data = await resp.json();
        renderOngoingGames(container, data.games || []);
    } catch (e) {
        console.warn('Failed to fetch ongoing games:', e);
        container.innerHTML = '';
    }
}

function renderOngoingGames(container, games) {
    if (!games || games.length === 0) {
        container.innerHTML = '';
        return;
    }
    const cardsHtml = games.map(g => {
        const opp = g.opponent || {};
        const oppName = opp.username || '?';
        const oppRating = opp.rating ? ` (${opp.rating})` : '';
        const color = g.color === 'white' ? '♔' : '♚';
        const turn = g.isMyTurn ? t('live.yourTurn') : t('live.opponentTurn');
        const turnBadge = g.isMyTurn ? 'pill-success' : 'pill-ghost';
        const speed = g.speed || '';
        const speedIcon = speed === 'bullet' ? '⚡' : speed === 'blitz' ? '🔥' : speed === 'rapid' ? '🕐' : speed === 'classical' ? '🐢' : '📧';
        const secs = g.secondsLeft || 0;
        const timeStr = secs >= 3600 ? `${Math.floor(secs/3600)}h${String(Math.floor((secs%3600)/60)).padStart(2,'0')}` :
                         secs >= 60 ? `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}` : `${secs}s`;
        return `
            <div class="card card-compact bg-base-200 ongoing-game-card" data-game-id="${g.gameId}">
                <div class="card-body flex-row items-center gap-3">
                    <div class="flex items-center gap-2 flex-1">
                        <span class="text-lg">${color}</span>
                        <span class="font-medium">${oppName}${oppRating}</span>
                        <span class="text-sm">${speedIcon}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="pill ${turnBadge} pill-xs">${turn}</span>
                        <span class="text-sm font-mono opacity-70">${timeStr}</span>
                    </div>
                    <button class="btn btn-sm btn-primary ongoing-game-join" data-join-game="${g.gameId}" title="${t('live.joinGame')}">${t('live.joinGame')}</button>
                </div>
            </div>`;
    }).join('');

    container.innerHTML = `
        <div class="ongoing-games-section mt-4">
            <div class="flex items-center gap-2 mb-2">
                <h3 class="text-base font-semibold">${t('live.ongoingGames')}</h3>
                <span class="badge badge-neutral badge-sm">${games.length}</span>
            </div>
            <div class="flex flex-col gap-2">
                ${cardsHtml}
            </div>
        </div>`;

    // Bind join buttons
    container.querySelectorAll('[data-join-game]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const gameId = btn.dataset.joinGame;
            btn.disabled = true;
            btn.textContent = '...';
            try {
                const resp = await apiFetch(`/api/live/join/${gameId}`, {
                    method: 'POST',
                    credentials: 'same-origin',
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    console.error('Join game failed:', err);
                    btn.textContent = t('live.joinGame');
                    btn.disabled = false;
                }
                // Success: WebSocket will receive game_start and switch view
            } catch (e) {
                console.error('Join game error:', e);
                btn.textContent = t('live.joinGame');
                btn.disabled = false;
            }
        });
    });
}

async function launchGame() {
    const btn = document.getElementById('btn-launch');
    if (btn) btn.disabled = true;

    const tcLabel = `${selectedTime.time}+${selectedTime.increment}`;

    // Persist lobby preferences to DB
    apiFetch('/api/auth/live-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            time: selectedTime.time,
            increment: selectedTime.increment,
            mode: selectedMode,
            rated: selectedRated,
            color: selectedColor,
        }),
    }).catch(() => {});

    try {
        if (selectedMode === 'seek') {
            if (!isSeekableTimeControl()) {
                showLobbyError(t('live.seekRapidOnly'));
                if (btn) btn.disabled = false;
                return;
            }
            const resp = await apiFetch('/api/live/seek', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    time: selectedTime.time,
                    increment: selectedTime.increment,
                    rated: selectedRated,
                    color: selectedColor,
                }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                console.error('Seek error:', err);
                showStatusMessage(t('live.seekError'));
                if (btn) btn.disabled = false;
                return;
            }
            // The seek is now active server-side — WS will broadcast "seeking" event
            // Show seeking UI immediately as optimistic update
            enterSeekingState(tcLabel);
        } else {
            const username = challengeUsername.trim();
            if (!username) {
                const input = document.getElementById('challenge-username');
                if (input) { input.focus(); input.classList.add('input-error'); setTimeout(() => input.classList.remove('input-error'), 2000); }
                if (btn) btn.disabled = false;
                return;
            }
            const resp = await apiFetch(`/api/live/challenge/${encodeURIComponent(username)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clock_limit: Math.round(selectedTime.time * 60),
                    clock_increment: selectedTime.increment,
                    rated: selectedRated,
                    color: selectedColor,
                }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                console.error('Challenge error:', err);
                showLobbyError(err.detail || t('live.challengeError'));
                if (btn) btn.disabled = false;
                return;
            }
            // Show challenge sent immediately (don't wait for WS event)
            const data = await resp.json().catch(() => ({}));
            const challengeId = data.challenge?.id || data.id || `tmp_${Date.now()}`;
            pendingChallenges.set(challengeId, {
                id: challengeId,
                _direction: 'sent',
                opponent: username,
                time_control: tcLabel,
                rated: selectedRated,
            });
            renderChallenges();
        }
        // Hide lobby after launch (will show seeking banner or game)
        newGamePanelOpen = false;
    } catch (e) {
        console.error('Launch error:', e);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function cancelSeek() {
    try {
        await apiFetch('/api/live/seek/cancel', { method: 'POST' });
    } catch (e) {
        console.error('Cancel seek error:', e);
    }
    exitSeekingState();
}

async function checkLiveStatus() {
    try {
        const resp = await fetch('/api/live/status');
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.status === 'seeking') {
            enterSeekingState('');
        }
    } catch { /* ignore */ }
}

function enterSeekingState(tcLabel) {
    isSeeking = true;
    seekingTimeControl = tcLabel;

    // Replace lobby with seeking banner
    hideEl('live-lobby');
    hideEl('live-ongoing-games');
    renderSeekingBanner(tcLabel);
}

function exitSeekingState() {
    isSeeking = false;
    seekingTimeControl = '';

    // Remove seeking banner, restore lobby
    const banner = document.getElementById('live-seeking-container');
    if (banner) banner.remove();

    if (!gameInProgress) {
        showEl('live-lobby');
        showEl('live-ongoing-games');
        renderLobby();
        fetchOngoingGames();
    }
}

function renderSeekingBanner(tcLabel) {
    // Insert seeking banner after lobby
    let container = document.getElementById('live-seeking-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'live-seeking-container';
        const lobby = document.getElementById('live-lobby');
        lobby?.parentNode?.insertBefore(container, lobby.nextSibling);
    }

    const tcDisplay = tcLabel || '...';
    container.innerHTML = `
        <div class="card bg-base-200 live-seeking-banner">
            <div class="card-body items-center text-center gap-3">
                <span class="loading loading-spinner loading-md"></span>
                <div class="seeking-text text-sm">
                    ${t('live.seeking', { timeControl: `<span class="font-bold">${escapeHtml(tcDisplay)}</span>` })}
                </div>
                <button class="btn btn-outline btn-sm" id="btn-cancel-seek">${t('live.seekCancel')}</button>
            </div>
        </div>
    `;

    document.getElementById('btn-cancel-seek')?.addEventListener('click', cancelSeek);
}

function showStatusMessage(msg) {
    const el = document.getElementById('live-status-text');
    if (el) el.textContent = msg;
}

// ─── Seek WebSocket handlers ─────────────────────────────────────

function onSeeking(data) {
    enterSeekingState(data.time_control || '');
}

function onSeekEnded(data) {
    exitSeekingState();
    if (data.reason === 'error') {
        showLobbyError(data.error || t('live.seekError'));
    }
}

function onSeekColorFallback(data) {
    const color = data.requested_color === 'white' ? t('live.white') : t('live.black');
    showSeekingNotice(t('live.colorBalanceNotice', { color }));
}

function showSeekingNotice(msg) {
    // Show info notice above the spinner inside the seeking card
    const seekContainer = document.getElementById('live-seeking-container');
    if (!seekContainer) return;
    const cardBody = seekContainer.querySelector('.card-body');
    if (!cardBody) return;
    let notice = cardBody.querySelector('.seek-notice');
    if (!notice) {
        notice = document.createElement('div');
        notice.className = 'seek-notice alert alert-warning text-sm w-full';
        cardBody.insertBefore(notice, cardBody.firstChild);
    }
    notice.innerHTML = escapeHtml(msg);
}

function showLobbyError(msg) {
    // Show error banner in the lobby
    let banner = document.getElementById('live-lobby-error');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'live-lobby-error';
        banner.className = 'alert alert-error text-sm mb-2';
        const lobby = document.getElementById('live-lobby');
        if (lobby) lobby.prepend(banner);
    }
    banner.innerHTML = escapeHtml(msg);
    banner.style.display = 'block';
    // Auto-hide after 8s
    setTimeout(() => { if (banner) banner.style.display = 'none'; }, 8000);
}

function onSeekCanceled() {
    exitSeekingState();
}

// ─── Spectating ──────────────────────────────────────────────────

async function startSpectating(username) {
    try {
        const resp = await apiFetch(`/api/live/spectate/${encodeURIComponent(username)}`, { method: 'POST' });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            console.error('[live] Spectate error:', err);
            // Show inline error
            const lobby = document.getElementById('live-lobby');
            if (lobby) {
                const msg = document.createElement('div');
                msg.className = 'alert alert-warning mt-2';
                msg.textContent = t('live.spectateError');
                lobby.prepend(msg);
                setTimeout(() => msg.remove(), 4000);
            }
        }
        // UI update will be triggered by WS 'spectate_start' event
    } catch (e) {
        console.error('[live] Spectate fetch error:', e);
    }
}

async function stopSpectating() {
    try {
        await apiFetch('/api/live/spectate-stop', { method: 'POST' });
    } catch (e) {
        console.error('[live] Stop spectate error:', e);
    }
    // UI update will be triggered by WS 'spectate_stopped' event
}

function onSpectateStart(data) {
    isSpectating = true;
    currentGameId = data.game_id;
    gameInProgress = true;
    gameOverData = null;
    isSeeking = false;
    spectatingWhiteName = data.white_name || 'White';
    spectatingBlackName = data.black_name || 'Black';
    spectatingWhiteRating = data.white_rating;
    spectatingBlackRating = data.black_rating;

    // Lock body scroll
    setLiveGameActive(true);

    // Reset coaching to OFF
    coachEnabled = false;
    const coachBtn = document.getElementById('btn-toggle-coach');
    coachBtn?.classList.remove('active');
    if (wsClient.ws && wsClient.ws.readyState === WebSocket.OPEN) {
        wsClient.ws.send(JSON.stringify({ type: 'toggle_coaching', enabled: false }));
    }

    // Exit fullscreen if active
    if (boardFullscreen) toggleFullscreen();

    // Hide lobby, show header + game area
    newGamePanelOpen = false;
    hideEl('live-lobby');
    hideEl('live-ongoing-games');
    const seekContainer = document.getElementById('live-seeking-container');
    if (seekContainer) seekContainer.remove();

    showEl('live-header');
    const txt = document.getElementById('live-status-text');
    if (txt) txt.textContent = t('live.spectating');

    const oppInfo = document.getElementById('live-opponent-info');
    if (oppInfo) oppInfo.textContent = `${spectatingWhiteName} vs ${spectatingBlackName}`;

    // Lichess link
    const linkBtn = document.getElementById('btn-lichess-link');
    if (linkBtn && data.game_id) {
        linkBtn.href = `https://lichess.org/${data.game_id}`;
        linkBtn.style.display = '';
    }

    // Show game area
    showEl('live-game-area');
    const goContainer = document.getElementById('live-game-over-container');
    if (goContainer) goContainer.innerHTML = '';

    // Init Chess.js + Chessground read-only
    chess = new Chess();
    moves = [];
    resetStats();

    if (ground) {
        ground.set({
            orientation: 'white',
            fen: 'start',
            turnColor: 'white',
            movable: {
                free: false,
                color: undefined,
                showDests: false,
                dests: new Map(),
            },
            draggable: { enabled: false },
        });
    }

    evalBar?.reset();
    evalBar?.setOrientation('white');

    const movesEl = document.getElementById('live-moves');
    if (movesEl) movesEl.innerHTML = '';

    // Player bars: white bottom, black top
    const topName = document.getElementById('player-name-top');
    const bottomName = document.getElementById('player-name-bottom');
    if (topName) {
        topName.textContent = spectatingBlackName + (spectatingBlackRating ? ` (${spectatingBlackRating})` : '');
        topName.classList.remove('cheater-flag');
        topName.removeAttribute('data-cheater-tooltip');
    }
    if (bottomName) {
        bottomName.textContent = spectatingWhiteName + (spectatingWhiteRating ? ` (${spectatingWhiteRating})` : '');
    }

    // Reset clocks
    stopClock();
    clockWhite = 0;
    clockBlack = 0;
    clockIncrement = 0;
    updateClockDisplay();

    // Show stats, replace game actions with spectate actions
    if (statsEnabled) showEl('live-stats-section');
    hideEl('game-actions');
    renderSpectateActions();
    updateStatsDisplay();
}

function renderSpectateActions() {
    // Remove existing spectate actions
    document.getElementById('spectate-actions')?.remove();

    const boardColumn = document.querySelector('.board-column');
    if (!boardColumn) return;

    const div = document.createElement('div');
    div.id = 'spectate-actions';
    div.className = 'game-actions';
    div.style.display = '';
    div.innerHTML = `
        <button class="btn btn-warning btn-sm btn-outline game-action-btn" id="btn-stop-spectating">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
                <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
            </svg>
            ${t('live.stopWatching')}
        </button>
    `;
    boardColumn.appendChild(div);

    document.getElementById('btn-stop-spectating')?.addEventListener('click', stopSpectating);
}

function onSpectateEnded(data) {
    gameInProgress = false;
    stopClock();
    setLiveGameActive(false);

    // Show game-end overlay on king squares
    const boardEl = document.getElementById('live-board');
    if (boardEl && chess) {
        const orientation = ground ? ground.state.orientation : 'white';
        showGameEndOverlay(boardEl, chess.fen(), data.result, data.status, orientation);
    }

    // Remove spectate action buttons
    document.getElementById('spectate-actions')?.remove();

    // Show result in game-over container
    const goContainer = document.getElementById('live-game-over-container');
    if (goContainer) {
        const resultText = data.result || '*';
        goContainer.innerHTML = `
            <div class="card bg-base-200 mt-2 p-3 text-center">
                <p class="font-bold text-lg mb-1">${t('live.spectatingEnded')}</p>
                <p class="text-base-content/70">${escapeHtml(data.white_name || spectatingWhiteName)} vs ${escapeHtml(data.black_name || spectatingBlackName)}</p>
                <p class="text-2xl font-bold my-2">${escapeHtml(resultText)}</p>
                <button class="btn btn-primary btn-sm mt-2" id="btn-spectate-back-lobby">${t('live.backToLobby')}</button>
            </div>
        `;
        document.getElementById('btn-spectate-back-lobby')?.addEventListener('click', backToLobby);
    }

    isSpectating = false;
}

function onSpectateStopped() {
    isSpectating = false;
    gameInProgress = false;
    stopClock();
    backToLobby();
}

function updateSpectatorBadge(count) {
    const badge = document.getElementById('spectator-count-badge');
    if (!badge) return;
    const eyeSvg = spectatorsBlocked
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4" style="display:inline;vertical-align:middle"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4" style="display:inline;vertical-align:middle"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    // Show badge if player is in a game (not spectating), or if count > 0
    if (!isSpectating && gameInProgress) {
        badge.innerHTML = `${eyeSvg} <span>${count}</span>`;
        badge.style.display = '';
        badge.classList.toggle('spectator-blocked', spectatorsBlocked);
    } else if (count > 0) {
        badge.innerHTML = `${eyeSvg} <span>${count}</span>`;
        badge.style.display = '';
        badge.classList.remove('spectator-blocked');
    } else {
        badge.style.display = 'none';
    }
}

function onSpectatorCount(data) {
    updateSpectatorBadge(data.count || 0);
}

function onSpectatorsBlocked(data) {
    spectatorsBlocked = !!data.blocked;
    // Re-render badge with current count
    const badge = document.getElementById('spectator-count-badge');
    const countSpan = badge?.querySelector('span');
    const count = countSpan ? parseInt(countSpan.textContent, 10) || 0 : 0;
    updateSpectatorBadge(count);
}

async function onToggleSpectatorsBlock() {
    // Only the player (not spectator) can toggle
    if (isSpectating || !gameInProgress) return;
    try {
        const resp = await apiFetch('/api/live/spectators-block', { method: 'POST' });
        if (!resp.ok) return;
        const data = await resp.json();
        spectatorsBlocked = !!data.blocked;
        updateSpectatorBadge(0);
    } catch (e) {
        console.error('[live] Toggle spectators block error:', e);
    }
}

function onSpectateKicked(data) {
    const who = data.username || '?';
    _spectateKickedMsg = t('live.spectateKicked', { username: who });
}

function onRouteReclick(e) {
    if (e.detail?.route === 'live') backToLobby();
}

function backToLobby() {
    // Unlock body scroll
    setLiveGameActive(false);
    isSpectating = false;
    // Remove spectate actions if present
    document.getElementById('spectate-actions')?.remove();
    // Hide spectator count
    const badge = document.getElementById('spectator-count-badge');
    if (badge) badge.style.display = 'none';
    // Hide game area + header + game over, show lobby
    hideEl('live-game-area');
    hideEl('live-header');
    hideEl('game-actions');
    const goContainer = document.getElementById('live-game-over-container');
    if (goContainer) goContainer.innerHTML = '';
    showEl('live-lobby');
    showEl('live-ongoing-games');
    renderLobby();
    fetchOngoingGames();
    // Show kick message if spectator was ejected
    if (_spectateKickedMsg) {
        const lobby = document.getElementById('live-lobby');
        if (lobby) {
            const toast = document.createElement('div');
            toast.className = 'alert alert-warning shadow-lg mb-3';
            toast.textContent = _spectateKickedMsg;
            lobby.prepend(toast);
            setTimeout(() => toast.remove(), 5000);
        }
        _spectateKickedMsg = null;
    }
}

// ─── Toolbar toggles ─────────────────────────────────────────────

function toggleCoach() {
    if (isFreeUser()) return;
    coachEnabled = !coachEnabled;
    const btn = document.getElementById('btn-toggle-coach');
    const layout = document.getElementById('live-layout');

    if (coachEnabled) {
        btn?.classList.add('active');
        btn?.setAttribute('title', t('live.hideCoach'));
        btn?.setAttribute('aria-label', t('live.hideCoach'));
    } else {
        btn?.classList.remove('active');
        btn?.setAttribute('title', t('live.showCoach'));
        btn?.setAttribute('aria-label', t('live.showCoach'));
    }

    // Toggle visibility of inline comments in the move list
    document.querySelectorAll('#live-moves .move-comment').forEach(el => {
        el.style.display = coachEnabled ? '' : 'none';
    });

    if (wsClient.ws && wsClient.ws.readyState === WebSocket.OPEN) {
        wsClient.ws.send(JSON.stringify({ type: 'toggle_coaching', enabled: coachEnabled }));
    }
}

function toggleEvalBar() {
    evalBarEnabled = !evalBarEnabled;
    const btn = document.getElementById('btn-toggle-eval');
    const layout = document.getElementById('live-layout');

    if (evalBarEnabled) {
        btn?.classList.add('active');
        btn?.setAttribute('title', t('live.hideEvalBar'));
        btn?.setAttribute('aria-label', t('live.hideEvalBar'));
        layout?.classList.remove('eval-bar-hidden');
    } else {
        btn?.classList.remove('active');
        btn?.setAttribute('title', t('live.showEvalBar'));
        btn?.setAttribute('aria-label', t('live.showEvalBar'));
        layout?.classList.add('eval-bar-hidden');
    }

    apiFetch('/api/auth/live-eval-bar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: evalBarEnabled }),
    }).catch(() => {});
}

function toggleStats() {
    statsEnabled = !statsEnabled;
    const btn = document.getElementById('btn-toggle-stats');
    const section = document.getElementById('live-stats-section');

    if (statsEnabled) {
        btn?.classList.add('active');
        btn?.setAttribute('title', t('live.hideStats'));
        btn?.setAttribute('aria-label', t('live.hideStats'));
        if (section && gameInProgress) section.style.display = '';
    } else {
        btn?.classList.remove('active');
        btn?.setAttribute('title', t('live.showStats'));
        btn?.setAttribute('aria-label', t('live.showStats'));
        if (section) section.style.display = 'none';
    }

    apiFetch('/api/auth/live-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: statsEnabled }),
    }).catch(() => {});
}

function toggleFullscreen() {
    boardFullscreen = !boardFullscreen;
    const layout = document.getElementById('live-layout');
    const btn = document.getElementById('btn-toggle-fullscreen');

    if (boardFullscreen) {
        layout?.classList.add('board-fullscreen');
        btn?.classList.add('active');
        btn?.setAttribute('title', t('live.exitFullscreen'));
        btn?.setAttribute('aria-label', t('live.exitFullscreen'));
        const gameArea = document.getElementById('live-game-area');
        if (gameArea?.requestFullscreen) {
            gameArea.requestFullscreen().catch(() => {});
        } else if (gameArea?.webkitRequestFullscreen) {
            gameArea.webkitRequestFullscreen();
        }
    } else {
        layout?.classList.remove('board-fullscreen');
        btn?.classList.remove('active');
        btn?.setAttribute('title', t('live.fullscreen'));
        btn?.setAttribute('aria-label', t('live.fullscreen'));
        // Exit native fullscreen
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch?.(() => {});
        }
    }

    // Redraw board after layout change
    if (ground) {
        setTimeout(() => ground.redrawAll(), 100);
    }
}

function onKeyDown(e) {
    if (e.key === 'Escape' && boardFullscreen) {
        toggleFullscreen();
    }
    if (e.key === 'ArrowLeft') navigateMove('prev');
    if (e.key === 'ArrowRight') navigateMove('next');
    if (e.key === 'Home') navigateMove('first');
    if (e.key === 'End') navigateMove('last');
}

function flipBoard() {
    if (!ground) return;
    const current = ground.state.orientation;
    const newOrientation = current === 'white' ? 'black' : 'white';
    ground.set({ orientation: newOrientation });
    evalBar?.setOrientation(newOrientation);

    // Swap player bars (name text + cheater flag)
    const topName = document.getElementById('player-name-top');
    const bottomName = document.getElementById('player-name-bottom');
    if (topName && bottomName) {
        const tmpText = topName.textContent;
        const tmpHasCheater = topName.classList.contains('cheater-flag');
        topName.textContent = bottomName.textContent;
        topName.classList.toggle('cheater-flag', bottomName.classList.contains('cheater-flag'));
        bottomName.textContent = tmpText;
        bottomName.classList.toggle('cheater-flag', tmpHasCheater);
    }

    // Clocks are updated automatically via updateClockDisplay which reads board orientation
    updateClockDisplay();
}

function navigateMove(dir) {
    if (moves.length === 0) return;
    const maxIdx = moves.length - 1;
    let newIndex = viewIndex;

    if (dir === 'first') newIndex = 0;
    else if (dir === 'prev') newIndex = viewIndex === -1 ? maxIdx : viewIndex - 1;
    else if (dir === 'next') newIndex = viewIndex === -1 ? -1 : viewIndex + 1;
    else if (dir === 'last') newIndex = -1; // live = latest

    // Clamp
    if (newIndex < 0 && newIndex !== -1) newIndex = -1;
    if (newIndex > maxIdx) newIndex = -1; // wrap to live

    viewIndex = newIndex;
    showPositionAtIndex(viewIndex);
}

function showPositionAtIndex(idx) {
    if (!ground) return;
    let fen;
    if (idx === -1 || idx >= moves.length) {
        // Show latest position
        fen = moves.length > 0 ? moves[moves.length - 1].fen_after : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        viewIndex = -1;
    } else {
        fen = moves[idx].fen_after;
    }

    // Detect check from the displayed FEN
    let checkColor = false;
    if (fen) {
        try {
            const temp = new Chess(fen);
            if (temp.in_check()) checkColor = temp.turn() === 'w' ? 'white' : 'black';
        } catch { /* ignore */ }
    }

    if (fen) {
        ground.set({
            fen: fen,
            lastMove: idx >= 0 && moves[idx] ? [moves[idx].uci.substring(0, 2), moves[idx].uci.substring(2, 4)] : undefined,
            check: checkColor,
        });
    }

    // Game-end overlay: show at last move when game is over, clear otherwise
    const boardEl = document.getElementById('live-board');
    if (boardEl) {
        clearGameEndOverlay(boardEl);
        const isAtEnd = (viewIndex === -1 || idx === moves.length - 1) && !gameInProgress && gameOverData;
        if (isAtEnd && fen) {
            const orientation = ground.state.orientation || 'white';
            showGameEndOverlay(boardEl, fen, gameOverData.result, gameOverData.cause || gameOverData.status, orientation);
        }
    }

    // When at live position, resync chess object and enable interaction
    const isLive = viewIndex === -1;
    if (isLive) {
        // Resync chess.js to the latest position
        const latestFen = moves.length > 0 ? moves[moves.length - 1].fen_after : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        try {
            const loaded = chess.load(latestFen);
            if (loaded === false) chess = new Chess(latestFen);
        } catch { chess = new Chess(latestFen); }

        if (gameInProgress) {
            updateBoardMovable();
        } else {
            ground.set({ movable: { dests: new Map(), color: undefined } });
        }
    } else {
        ground.set({ movable: { dests: new Map(), color: undefined } });
    }

    // Highlight current move in move list
    document.querySelectorAll('#live-moves .move').forEach(el => el.classList.remove('current'));
    if (idx >= 0 && moves[idx]) {
        const row = document.querySelector(`#live-moves .move-row[data-move-number="${moves[idx].move_number}"]`);
        if (row) {
            const moveEl = moves[idx].color === 'w' ? row.querySelector('.white-move') : row.querySelector('.black-move');
            moveEl?.classList.add('current');
        }
    }
}

function onFullscreenChange() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement && boardFullscreen) {
        boardFullscreen = false;
        const layout = document.getElementById('live-layout');
        const btn = document.getElementById('btn-toggle-fullscreen');
        layout?.classList.remove('board-fullscreen');
        btn?.classList.remove('active');
        btn?.setAttribute('title', t('live.fullscreen'));
        btn?.setAttribute('aria-label', t('live.fullscreen'));
        if (ground) setTimeout(() => ground.redrawAll(), 100);
    }
}

// ─── Challenge notifications ─────────────────────────────────────

function onChallengeIncoming(data) {
    data._direction = 'incoming';
    pendingChallenges.set(data.id, data);
    renderChallenges();
}

function onChallengeSent(data) {
    data._direction = 'sent';
    pendingChallenges.set(data.id, data);
    renderChallenges();
}

function onChallengeCanceled(data) {
    pendingChallenges.delete(data.id);
    renderChallenges();
}

function onChallengeDeclined(data) {
    pendingChallenges.delete(data.id);
    renderChallenges();
}

function renderChallenges() {
    const container = document.getElementById('live-challenges');
    if (!container) return;

    if (pendingChallenges.size === 0) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    for (const [id, ch] of pendingChallenges) {
        const ratedText = ch.rated ? t('live.rated') : t('live.casual');

        if (ch._direction === 'sent') {
            // Outgoing challenge
            const msg = t('live.challengeSentWaiting', {
                opponent: ch.opponent || '?',
                timeControl: ch.time_control || '?',
                rated: ratedText,
            });
            html += `
                <div class="alert alert-info shadow-lg mb-2 live-challenge-toast" data-challenge-id="${escapeAttr(id)}">
                    <span class="challenge-info flex-1">${escapeHtml(msg)}</span>
                    <div class="challenge-actions flex gap-2">
                        <button class="btn btn-warning btn-sm btn-cancel-challenge" data-id="${escapeAttr(id)}">${t('live.cancelChallenge')}</button>
                    </div>
                </div>
            `;
        } else {
            // Incoming challenge
            const msg = t('live.challengeIncoming', {
                challenger: ch.challenger || '?',
                rating: ch.rating || '?',
                timeControl: ch.time_control || '?',
                rated: ratedText,
            });
            html += `
                <div class="alert alert-warning shadow-lg mb-2 live-challenge-toast" data-challenge-id="${escapeAttr(id)}">
                    <span class="challenge-info flex-1">${escapeHtml(msg)}</span>
                    <div class="challenge-actions flex gap-2">
                        <button class="btn btn-success btn-sm btn-accept" data-id="${escapeAttr(id)}">${t('live.accept')}</button>
                        <button class="btn btn-ghost btn-sm btn-decline" data-id="${escapeAttr(id)}">${t('live.decline')}</button>
                    </div>
                </div>
            `;
        }
    }
    container.innerHTML = html;

    container.querySelectorAll('.btn-accept').forEach(btn => {
        btn.addEventListener('click', async () => {
            const cid = btn.dataset.id;
            await apiFetch(`/api/live/challenge/${cid}/accept`, { method: 'POST' });
            pendingChallenges.delete(cid);
            renderChallenges();
        });
    });
    container.querySelectorAll('.btn-decline').forEach(btn => {
        btn.addEventListener('click', async () => {
            const cid = btn.dataset.id;
            await apiFetch(`/api/live/challenge/${cid}/decline`, { method: 'POST' });
            pendingChallenges.delete(cid);
            renderChallenges();
        });
    });
    container.querySelectorAll('.btn-cancel-challenge').forEach(btn => {
        btn.addEventListener('click', async () => {
            const cid = btn.dataset.id;
            try {
                await apiFetch(`/api/live/challenge/${cid}/cancel`, { method: 'POST' });
            } catch (e) {
                console.error('[live] Cancel challenge error:', e);
            }
            pendingChallenges.delete(cid);
            renderChallenges();
        });
    });
}

async function loadPendingChallenges() {
    try {
        const resp = await apiFetch('/api/live/challenges');
        if (resp.ok) {
            const data = await resp.json();
            for (const ch of (data.challenges || [])) {
                if (ch.type === 'challenge_sent') ch._direction = 'sent';
                else ch._direction = 'received';
                pendingChallenges.set(ch.id, ch);
            }
            renderChallenges();
        }
    } catch { /* ignore */ }
}

// ─── WebSocket event handlers ────────────────────────────────────

function onConnected() {
    isConnected = true;
    const dot = document.getElementById('live-status');
    if (dot) dot.className = 'badge badge-success badge-xs';
    const txt = document.getElementById('live-status-text');
    if (txt && !gameInProgress) txt.textContent = t('live.waiting');
}

function onDisconnected() {
    isConnected = false;
    const dot = document.getElementById('live-status');
    if (dot) dot.className = 'badge badge-error badge-xs';
    const txt = document.getElementById('live-status-text');
    if (txt) txt.textContent = t('live.disconnected');
}

function onGameStart(data) {
    currentGameId = data.game_id;
    dbGameId = null;
    gameInProgress = true;
    gameOverData = null;
    moveInFlight = false;
    preMovefen = null;
    isSeeking = false;
    pendingChallenges.clear();
    renderChallenges();
    ourColor = data.our_color || 'w';
    opponentName = data.opponent || '?';
    chess = new Chess();
    moves = [];
    resetStats();

    // Lock body scroll on mobile during game
    setLiveGameActive(true);

    // Reset coaching to OFF at game start
    coachEnabled = false;
    const coachBtn = document.getElementById('btn-toggle-coach');
    coachBtn?.classList.remove('active');
    coachBtn?.setAttribute('title', t('live.showCoach'));
    // Ensure backend knows coaching is OFF
    if (wsClient.ws && wsClient.ws.readyState === WebSocket.OPEN) {
        wsClient.ws.send(JSON.stringify({ type: 'toggle_coaching', enabled: false }));
    }
    // Exit fullscreen if active
    if (boardFullscreen) toggleFullscreen();

    // Hide lobby + seeking banner, show header
    newGamePanelOpen = false;
    hideEl('live-lobby');
    hideEl('live-ongoing-games');
    const seekContainer = document.getElementById('live-seeking-container');
    if (seekContainer) seekContainer.remove();

    // Show header with game info
    showEl('live-header');
    const txt = document.getElementById('live-status-text');
    if (txt) txt.textContent = t('live.nowPlaying', {
        opponent: opponentName,
        color: ourColor === 'w' ? t('live.white') : t('live.black'),
    });

    const oppInfo = document.getElementById('live-opponent-info');
    if (oppInfo) oppInfo.textContent = '';

    // Show spectator eye badge (player can toggle blocking)
    spectatorsBlocked = false;
    updateSpectatorBadge(0);

    // Lichess link
    const linkBtn = document.getElementById('btn-lichess-link');
    if (linkBtn && data.game_id) {
        linkBtn.href = `https://lichess.org/${data.game_id}`;
        linkBtn.style.display = '';
    }

    // Show game area, hide game over
    showEl('live-game-area');
    const goContainer = document.getElementById('live-game-over-container');
    if (goContainer) goContainer.innerHTML = '';

    // Setup board — interactive for our color
    chess = new Chess();
    const colorName = ourColor === 'w' ? 'white' : 'black';

    evalBar?.reset();
    evalBar?.setOrientation(ourColor === 'w' ? 'white' : 'black');

    // Clear move list before populating
    const movesEl = document.getElementById('live-moves');
    if (movesEl) movesEl.innerHTML = '';

    // If joining an ongoing game, apply existing moves
    if (data.existing_moves && data.existing_moves.length > 0) {
        for (const m of data.existing_moves) {
            if (m.fen_after) {
                try {
                    const loaded = chess.load(m.fen_after);
                    if (loaded === false) chess = new Chess(m.fen_after);
                } catch { chess = new Chess(m.fen_after); }
            }
            moves.push({ ...m, classification: null });
            addMoveToList(m);
        }
    }

    const startFen = data.current_fen || (moves.length > 0 ? chess.fen() : 'start');
    const currentTurn = chess.turn() === 'w' ? 'white' : 'black';
    const isOurTurn = chess.turn() === ourColor;

    if (ground) {
        ground.set({
            orientation: colorName,
            fen: startFen,
            turnColor: currentTurn,
            movable: {
                free: false,
                color: colorName,
                showDests: true,
                dests: isOurTurn ? getLegalDests() : new Map(),
                events: { after: onBoardMove },
            },
            draggable: { enabled: true },
        });
    }

    // Setup player bars (top = opponent, bottom = us)
    const topName = document.getElementById('player-name-top');
    const bottomName = document.getElementById('player-name-bottom');
    if (topName) {
        topName.textContent = opponentName + (data.opponent_rating ? ` (${data.opponent_rating})` : '');
        if (showCheaterFlag && data.opponent_tos) {
            topName.classList.add('cheater-flag');
            topName.setAttribute('data-cheater-tooltip', t('live.cheaterFlag'));
        } else {
            topName.classList.remove('cheater-flag');
            topName.removeAttribute('data-cheater-tooltip');
        }
    }
    if (bottomName) bottomName.textContent = ourUsername || t('live.you');

    // Reset clocks — use times from game_start if rejoining
    stopClock();
    clockWhite = data.wtime || 0;
    clockBlack = data.btime || 0;
    clockIncrement = 0;
    updateClockDisplay();
    // Start clock ticking immediately if we have times and moves
    if ((data.wtime || data.btime) && moves.length > 0) {
        startClock(chess.turn());
    }

    // Show stats section (if enabled) + game actions
    if (statsEnabled) showEl('live-stats-section');
    showEl('game-actions');
    updateStatsDisplay();

    // Reset action button states
    resignConfirming = false;
    abortConfirming = false;
}

function onGameClock(data) {
    if (data.game_id !== currentGameId) return;
    if (data.clock_increment) clockIncrement = data.clock_increment;
    if (data.wtime != null) clockWhite = data.wtime;
    if (data.btime != null) clockBlack = data.btime;
    updateClockDisplay();

    // Update player names with ratings if available from gameFull
    if (data.our_rating || data.opponent_rating) {
        const topName = document.getElementById('player-name-top');
        const bottomName = document.getElementById('player-name-bottom');
        if (topName && opponentName) {
            topName.textContent = opponentName + (data.opponent_rating ? ` (${data.opponent_rating})` : '');
        }
        if (bottomName && ourUsername) {
            bottomName.textContent = ourUsername + (data.our_rating ? ` (${data.our_rating})` : '');
        }
    }

    // Start clock for whoever's turn it is
    const turn = chess.turn();
    startClock(turn);
}

function fenPosition(fen) {
    // Compare only position + turn + castling + en-passant (first 4 FEN fields), ignore counters
    return fen ? fen.split(' ').slice(0, 4).join(' ') : '';
}

function onMovePlayed(data) {
    if (data.game_id !== currentGameId) return;

    const currentPos = fenPosition(chess.fen());
    const newPos = fenPosition(data.fen_after);

    // Update chess.js and board only if position changed (skip for our own moves — already applied locally)
    if (data.fen_after && newPos !== currentPos) {
        try {
            const loaded = chess.load(data.fen_after);
            if (loaded === false) {
                chess = new Chess(data.fen_after);
            }
        } catch (e) {
            chess = new Chess(data.fen_after);
        }

        if (ground) {
            ground.set({
                fen: data.fen_after,
                lastMove: data.uci ? [data.uci.slice(0, 2), data.uci.slice(2, 4)] : undefined,
                check: chess.in_check() ? (chess.turn() === 'w' ? 'white' : 'black') : false,
            });
            updateBoardMovable();
        }
    }

    // Update clocks
    if (data.wtime != null && data.btime != null) {
        clockWhite = data.wtime;
        clockBlack = data.btime;
        const nextTurn = chess.turn();
        startClock(nextTurn);
        updateClockDisplay();
    }

    // Add move to list (without classification yet)
    addMoveToList(data);

    // Track move in array
    moves.push({ ...data, classification: null });

    // Update stats display in spectating mode (move count comes from moves.length)
    if (isSpectating) updateStatsDisplay();

    // If user was viewing latest, keep them there
    if (viewIndex === -1) {
        // Already at live — no navigation needed
    }
}

function onMoveEval(data) {
    if (data.game_id !== currentGameId) return;

    // Update eval bar only (board already updated by onMovePlayed)
    evalBar?.update(data.eval_cp, data.eval_mate);

    // Update classification badge on existing move in list
    updateMoveClassificationBadge(data.move_number, data.color, data.classification);

    // Update stored move data
    const moveIdx = moves.findIndex(m => m.move_number === data.move_number && m.color === data.color);
    if (moveIdx >= 0) {
        moves[moveIdx] = { ...moves[moveIdx], ...data };
    }

    // Update live stats
    if (isSpectating) {
        // Spectating: track stats per color
        const cs = data.color === 'w' ? whiteStats : blackStats;
        cs.moves++;
        if (data.centipawn_loss !== undefined) {
            const acc = Math.max(0, 1 - data.centipawn_loss / 300) * 100;
            cs.accuracy.push(acc);
        }
        if (data.classification === 'brilliant') cs.brilliants++;
        else if (data.classification === 'great') cs.greats++;
        else if (data.classification === 'blunder') cs.blunders++;
        else if (data.classification === 'mistake') cs.mistakes++;
        else if (data.classification === 'inaccuracy') cs.inaccuracies++;
        updateStatsDisplay();
    } else if (data.color === ourColor) {
        stats.ourMoves++;
        if (data.centipawn_loss !== undefined) {
            const acc = Math.max(0, 1 - data.centipawn_loss / 300) * 100;
            stats.accuracy.push(acc);
        }
        if (data.classification === 'brilliant') stats.brilliants++;
        else if (data.classification === 'great') stats.greats++;
        else if (data.classification === 'blunder') stats.blunders++;
        else if (data.classification === 'mistake') stats.mistakes++;
        else if (data.classification === 'inaccuracy') stats.inaccuracies++;
        updateStatsDisplay();
    }
}

function onMoveComment(data) {
    if (data.game_id !== currentGameId) return;
    if (!data.ai_comment) return;

    const movesEl = document.getElementById('live-moves');
    if (!movesEl) return;

    const row = movesEl.querySelector(`.move-row[data-move-number="${data.move_number}"]`);
    if (!row) return;

    // Remove existing comment for this move if any
    const existing = movesEl.querySelector(`.move-comment[data-move-number="${data.move_number}"]`);
    if (existing) existing.remove();

    const comment = document.createElement('div');
    comment.className = 'move-comment';
    comment.dataset.moveNumber = data.move_number;
    comment.innerHTML = `<span class="move-comment-text">${escapeHtml(data.ai_comment)}</span>`;

    // Insert right after the move row
    row.after(comment);

    // Auto-scroll to the comment
    movesEl.scrollTop = movesEl.scrollHeight;
}

function onGameOver(data) {
    if (data.game_id !== currentGameId) return;

    gameInProgress = false;
    gameOverData = data;
    dbGameId = data.db_game_id || null;
    stopClock();

    // Unlock body scroll
    setLiveGameActive(false);

    // Hide game action buttons
    hideEl('game-actions');

    // Disable board interaction
    if (ground) {
        ground.set({
            movable: { free: false, color: undefined, dests: new Map() },
            draggable: { enabled: false },
        });
    }

    // Show game-end overlay on king squares
    const boardEl = document.getElementById('live-board');
    if (boardEl && chess) {
        const orientation = ground ? ground.state.orientation : 'white';
        showGameEndOverlay(boardEl, chess.fen(), data.result, data.cause || data.status, orientation);
    }

    // Determine result type for styling
    const resultInfo = getResultInfo(data.result);

    // Update header
    const txt = document.getElementById('live-status-text');
    if (txt) txt.textContent = resultInfo.text;

    // Extract stats from data (enriched game_over message)
    const gameStats = data.stats || {};
    const modalStats = {
        good: (gameStats.brilliant || 0) + (gameStats.great || 0) + (gameStats.good || 0),
        mistakes: (gameStats.inaccuracy || 0) + (gameStats.mistake || 0),
        blunders: gameStats.blunder || 0,
    };

    // Delay the modal to let the king animation play (0.3s tilt + 0.4s badge pop)
    setTimeout(() => {
        showGameModal({
            result: data.result,
            cause: data.cause || data.status,
            stats: modalStats,
            gameId: currentGameId,
            dbGameId,
            opponent: opponentName,
            ourColor,
            onNewGame: backToLobby,
            onRematch: () => {
                // Re-seek with same time control
                backToLobby();
                setTimeout(() => {
                    const launchBtn = document.getElementById('btn-launch');
                    if (launchBtn) launchBtn.click();
                }, 300);
            },
        });
    }, 800);

    // Also render inline game-over in the panel (for when modal is closed)
    const goContainer = document.getElementById('live-game-over-container');
    if (goContainer) {
        goContainer.innerHTML = `
            <div class="live-game-over">
                <div class="result-banner ${resultInfo.cls}">
                    <span class="result-icon">${resultInfo.icon}</span>
                    <span>${resultInfo.text}</span>
                </div>
                ${renderFinalStats()}
                <div class="game-over-actions">
                    ${dbGameId ? `<a class="btn btn-outline btn-sm" href="#review/${dbGameId}">${t('live.reviewGame')}</a>` : ''}
                    <button class="btn btn-primary btn-sm" id="btn-play-again">${t('live.newGame')}</button>
                </div>
            </div>
        `;
        document.getElementById('btn-play-again')?.addEventListener('click', backToLobby);
    }
}

function onGameSummary(data) {
    if (data.game_id !== currentGameId) return;

    // Update db_game_id if provided
    if (data.db_game_id) {
        dbGameId = data.db_game_id;
    }

    // Update the DaisyUI modal with AI summary
    if (data.ai_summary) {
        updateGameSummary(data.ai_summary);
    }

    // Also update inline game-over container
    const goContainer = document.getElementById('live-game-over-container');
    if (!goContainer) return;
    const gameOver = goContainer.querySelector('.live-game-over');
    if (!gameOver) return;

    if (data.ai_summary) {
        const summaryEl = document.createElement('div');
        summaryEl.innerHTML = `
            <h4>${t('live.postGameAnalysis')}</h4>
            <div class="markdown-content">${formatMarkdown(data.ai_summary)}</div>
        `;
        gameOver.appendChild(summaryEl);
    }

    // Add review button if not already present
    if (dbGameId) {
        const actionsDiv = gameOver.querySelector('.game-over-actions');
        if (actionsDiv && !actionsDiv.querySelector('a[href*="review"]')) {
            const reviewLink = document.createElement('a');
            reviewLink.className = 'btn btn-outline btn-sm';
            reviewLink.href = `#review/${dbGameId}`;
            reviewLink.textContent = t('live.reviewGame');
            actionsDiv.insertBefore(reviewLink, actionsDiv.firstChild);
        }
    }
}

function getResultInfo(result) {
    // Determine if we won, lost, or drew
    const isWhite = ourColor === 'w';
    if (result === '*') {
        return { text: t('live.resultAborted'), icon: '—', cls: 'result-draw' };
    }
    if (result === '1/2-1/2') {
        return { text: t('live.resultDraw'), icon: '=', cls: 'result-draw' };
    }
    const weWon = (result === '1-0' && isWhite) || (result === '0-1' && !isWhite);
    if (weWon) {
        return { text: t('live.resultWin'), icon: '+', cls: 'result-win' };
    }
    return { text: t('live.resultLoss'), icon: '-', cls: 'result-loss' };
}

// ─── Stats ───────────────────────────────────────────────────────

function resetStats() {
    stats = { accuracy: [], brilliants: 0, greats: 0, blunders: 0, mistakes: 0, inaccuracies: 0, ourMoves: 0 };
    whiteStats = { accuracy: [], brilliants: 0, greats: 0, blunders: 0, mistakes: 0, inaccuracies: 0, moves: 0 };
    blackStats = { accuracy: [], brilliants: 0, greats: 0, blunders: 0, mistakes: 0, inaccuracies: 0, moves: 0 };
}

function getAvgAccuracy() {
    if (stats.accuracy.length === 0) return 0;
    return stats.accuracy.reduce((a, b) => a + b, 0) / stats.accuracy.length;
}

function getAvgAccuracyFor(colorStats) {
    if (colorStats.accuracy.length === 0) return 0;
    return colorStats.accuracy.reduce((a, b) => a + b, 0) / colorStats.accuracy.length;
}

function renderColorStats(label, cs) {
    const acc = Math.round(getAvgAccuracyFor(cs));
    return `
        <div class="mb-1">
            <div class="font-semibold text-xs mb-1">${escapeHtml(label)}</div>
            <div class="flex items-center gap-2 text-xs mb-1">
                <span>${t('live.accuracy')}: <strong>${acc}%</strong></span>
                <span>${t('live.moves')}: <strong>${cs.moves}</strong></span>
            </div>
            <div class="flex flex-wrap gap-1">
                <span class="stat-item"><span class="badge badge-brilliant">!!</span> ${cs.brilliants}</span>
                <span class="stat-item"><span class="badge badge-great">!</span> ${cs.greats}</span>
                <span class="stat-item"><span class="badge badge-blunder">??</span> ${cs.blunders}</span>
                <span class="stat-item"><span class="badge badge-mistake">?</span> ${cs.mistakes}</span>
                <span class="stat-item"><span class="badge badge-inaccuracy">?!</span> ${cs.inaccuracies}</span>
            </div>
        </div>`;
}

function updateStatsDisplay() {
    const el = document.getElementById('live-stats');
    if (!el) return;

    if (isSpectating) {
        // Spectating: show stats per color
        const wLabel = spectatingWhiteName || 'White';
        const bLabel = spectatingBlackName || 'Black';
        const fullMoves = Math.ceil(moves.length / 2);
        el.innerHTML = `
            <div class="bg-base-100 rounded-box p-2 text-xs">
                <div class="stat py-1 px-2">
                    <div class="stat-title text-xs">${t('live.moves')}</div>
                    <div class="stat-value text-lg">${fullMoves}</div>
                </div>
                <div class="divider my-1"></div>
                ${renderColorStats('♔ ' + wLabel, whiteStats)}
                <div class="divider my-1"></div>
                ${renderColorStats('♚ ' + bLabel, blackStats)}
            </div>
        `;
        return;
    }

    const acc = Math.round(getAvgAccuracy());
    const moveCount = stats.ourMoves;
    el.innerHTML = `
        <div class="stats stats-vertical shadow-sm bg-base-100 w-full text-xs">
            <div class="stat py-2 px-3">
                <div class="stat-title text-xs">${t('live.accuracy')}</div>
                <div class="stat-value text-lg">${acc}%</div>
            </div>
            <div class="stat py-2 px-3">
                <div class="stat-title text-xs">${t('live.moves')}</div>
                <div class="stat-value text-lg">${moveCount}</div>
            </div>
        </div>
        <div class="flex flex-wrap gap-1 mt-2">
            <span class="stat-item"><span class="badge badge-brilliant">!!</span> ${stats.brilliants}</span>
            <span class="stat-item"><span class="badge badge-great">!</span> ${stats.greats}</span>
            <span class="stat-item"><span class="badge badge-blunder">??</span> ${stats.blunders}</span>
            <span class="stat-item"><span class="badge badge-mistake">?</span> ${stats.mistakes}</span>
            <span class="stat-item"><span class="badge badge-inaccuracy">?!</span> ${stats.inaccuracies}</span>
        </div>
    `;
}

function renderFinalStats() {
    const acc = Math.round(getAvgAccuracy());
    return `
        <div class="live-stats live-final-stats">
            <span class="stat-item"><span class="stat-label">${t('live.accuracy')}:</span> ${acc}%</span>
            <span class="stat-item"><span class="badge badge-brilliant">!!</span> ${stats.brilliants}</span>
            <span class="stat-item"><span class="badge badge-great">!</span> ${stats.greats}</span>
            <span class="stat-item"><span class="badge badge-blunder">??</span> ${stats.blunders}</span>
            <span class="stat-item"><span class="badge badge-mistake">?</span> ${stats.mistakes}</span>
            <span class="stat-item"><span class="badge badge-inaccuracy">?!</span> ${stats.inaccuracies}</span>
        </div>
    `;
}

// ─── Move list ───────────────────────────────────────────────────

function addMoveToList(data) {
    const movesEl = document.getElementById('live-moves');
    if (!movesEl) return;

    if (data.color === 'w') {
        const row = document.createElement('div');
        row.className = 'move-row';
        row.dataset.moveNumber = data.move_number;
        row.innerHTML = `
            <span class="move-number">${data.move_number}.</span>
            <span class="move white-move">${escapeHtml(data.san)}</span>
            <span class="move black-move"></span>
        `;
        movesEl.appendChild(row);
    } else {
        const row = movesEl.querySelector(`.move-row[data-move-number="${data.move_number}"]`);
        if (row) {
            const blackMove = row.querySelector('.black-move');
            if (blackMove) {
                blackMove.textContent = data.san;
            }
        }
    }

    movesEl.scrollTop = movesEl.scrollHeight;
}

function updateMoveClassificationBadge(moveNumber, color, classification) {
    const movesEl = document.getElementById('live-moves');
    if (!movesEl || !classification) return;

    const row = movesEl.querySelector(`.move-row[data-move-number="${moveNumber}"]`);
    if (!row) return;

    const moveEl = color === 'w'
        ? row.querySelector('.white-move')
        : row.querySelector('.black-move');

    if (moveEl) {
        moveEl.className = `move ${color === 'w' ? 'white' : 'black'}-move ${classification}`;
    }
}

// ─── Clock ────────────────────────────────────────────────────────

function startClock(color) {
    stopClock();
    if (!gameInProgress) return;
    clockActive = color;
    clockLastTick = Date.now();
    clockInterval = setInterval(tickClock, 100);
}

function stopClock() {
    if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
    }
    clockActive = null;
}

function tickClock() {
    if (!clockActive) return;
    const now = Date.now();
    const elapsed = now - clockLastTick;
    clockLastTick = now;

    if (clockActive === 'w') {
        clockWhite = Math.max(0, clockWhite - elapsed);
        if (clockWhite <= 0) {
            stopClock();
        }
    } else {
        clockBlack = Math.max(0, clockBlack - elapsed);
        if (clockBlack <= 0) {
            stopClock();
        }
    }

    updateClockDisplay();
}

function updateClockDisplay() {
    const topEl = document.getElementById('clock-top');
    const bottomEl = document.getElementById('clock-bottom');
    if (!topEl || !bottomEl) return;

    // Determine which color is at the bottom based on board orientation
    const orientation = ground ? ground.state.orientation : 'white';
    const bottomColor = orientation === 'white' ? 'w' : 'b';
    const topColor = bottomColor === 'w' ? 'b' : 'w';

    const topTime = topColor === 'w' ? clockWhite : clockBlack;
    const bottomTime = bottomColor === 'w' ? clockWhite : clockBlack;

    topEl.textContent = formatClock(topTime);
    bottomEl.textContent = formatClock(bottomTime);

    topEl.classList.toggle('clock-active', clockActive === topColor);
    bottomEl.classList.toggle('clock-active', clockActive === bottomColor);

    topEl.classList.toggle('clock-low', topTime > 0 && topTime < 30000);
    bottomEl.classList.toggle('clock-low', bottomTime > 0 && bottomTime < 30000);
}

function formatClock(ms) {
    if (ms <= 0 && clockWhite === 0 && clockBlack === 0) return '--:--';
    if (ms <= 0) return '0:00';
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}:${mins.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    if (ms < 10000) {
        // Under 10 seconds: show tenths
        const secs = Math.floor(ms / 1000);
        const tenths = Math.floor((ms % 1000) / 100);
        return `0:${secs.toString().padStart(2, '0')}.${tenths}`;
    }

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ─── Board interaction ───────────────────────────────────────────

function getLegalDests() {
    const dests = new Map();
    if (!chess) { console.warn('[live] getLegalDests: chess is null'); return dests; }
    try {
        const legalMoves = chess.moves({ verbose: true });
        for (const m of legalMoves) {
            if (!dests.has(m.from)) dests.set(m.from, []);
            dests.get(m.from).push(m.to);
        }
    } catch (e) {
        console.error('[live] getLegalDests error:', e);
    }
    return dests;
}

function updateBoardMovable() {
    if (!ground || !gameInProgress) return;
    if (isSpectating) {
        ground.set({
            turnColor: chess.turn() === 'w' ? 'white' : 'black',
            check: chess.in_check() ? (chess.turn() === 'w' ? 'white' : 'black') : false,
            movable: { free: false, color: undefined, showDests: false, dests: new Map() },
            draggable: { enabled: false },
        });
        return;
    }
    const turn = chess.turn(); // 'w' or 'b'
    const isOurTurn = turn === ourColor;
    const colorName = ourColor === 'w' ? 'white' : 'black';
    const dests = isOurTurn ? getLegalDests() : new Map();
    ground.set({
        turnColor: turn === 'w' ? 'white' : 'black',
        check: chess.in_check() ? (turn === 'w' ? 'white' : 'black') : false,
        movable: {
            free: false,
            color: isOurTurn ? colorName : undefined,
            showDests: true,
            dests: dests,
            events: { after: onBoardMove },
        },
        draggable: { enabled: true },
    });
}

async function onBoardMove(orig, dest) {
    if (!currentGameId || !gameInProgress || isSpectating) return;
    if (moveInFlight) return; // Prevent concurrent move submissions

    // Determine if promotion
    const piece = chess.get(orig);
    let promotion = undefined;
    if (piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
        promotion = 'q'; // Auto-promote to queen
    }

    // Save FEN before our move (for safe rollback)
    preMovefen = chess.fen();

    // Apply move locally in chess.js first
    const localMove = chess.move({ from: orig, to: dest, promotion });
    if (!localMove) {
        console.warn('[live] Local move invalid:', orig, dest, 'FEN:', chess.fen());
        preMovefen = null;
        ground.set({ fen: chess.fen() });
        updateBoardMovable();
        return;
    }

    // FEN right after our local move — used to detect if game has progressed
    const postMoveFen = fenPosition(chess.fen());
    moveInFlight = true;

    // Immediately disable our movement + show check highlight
    updateBoardMovable();

    // Build UCI string
    let uci = orig + dest;
    if (promotion) uci += promotion;

    // Send move to Lichess via backend
    try {
        const resp = await apiFetch(`/api/live/move/${encodeURIComponent(currentGameId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uci }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            console.error('[live] Move rejected by server:', err);
            // Only rollback if game hasn't progressed past our move
            // (opponent's move_played could have arrived during the await)
            if (fenPosition(chess.fen()) === postMoveFen && preMovefen) {
                try {
                    const loaded = chess.load(preMovefen);
                    if (loaded === false) chess = new Chess(preMovefen);
                } catch { chess = new Chess(preMovefen); }
                ground.set({ fen: chess.fen() });
                updateBoardMovable();
            }
        }
    } catch (e) {
        console.error('[live] Move send error:', e);
        if (fenPosition(chess.fen()) === postMoveFen && preMovefen) {
            try {
                const loaded = chess.load(preMovefen);
                if (loaded === false) chess = new Chess(preMovefen);
            } catch { chess = new Chess(preMovefen); }
            ground.set({ fen: chess.fen() });
            updateBoardMovable();
        }
    } finally {
        moveInFlight = false;
        preMovefen = null;
    }
}

// ─── Game Actions (resign / draw / abort) ────────────────────────

let resignConfirming = false;
let abortConfirming = false;

function onResignClick() {
    if (!currentGameId || !gameInProgress) return;
    const btn = document.getElementById('btn-resign');
    if (!btn) return;

    if (!resignConfirming) {
        resignConfirming = true;
        btn.classList.add('confirm');
        btn.textContent = t('live.confirmResign');
        setTimeout(() => {
            if (resignConfirming) {
                resignConfirming = false;
                btn.classList.remove('confirm');
                btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg> ${t('live.resign')}`;
            }
        }, 3000);
    } else {
        resignConfirming = false;
        btn.disabled = true;
        apiFetch(`/api/live/resign/${encodeURIComponent(currentGameId)}`, { method: 'POST' })
            .catch(e => console.error('Resign error:', e))
            .finally(() => { if (btn) btn.disabled = false; });
    }
}

function onAbortClick() {
    if (!currentGameId || !gameInProgress) return;
    const btn = document.getElementById('btn-abort');
    if (!btn) return;

    if (!abortConfirming) {
        abortConfirming = true;
        btn.classList.add('confirm');
        btn.textContent = t('live.confirmAbort');
        setTimeout(() => {
            if (abortConfirming) {
                abortConfirming = false;
                btn.classList.remove('confirm');
                btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ${t('live.abort')}`;
            }
        }, 3000);
    } else {
        abortConfirming = false;
        btn.disabled = true;
        apiFetch(`/api/live/abort/${encodeURIComponent(currentGameId)}`, { method: 'POST' })
            .catch(e => console.error('Abort error:', e))
            .finally(() => { if (btn) btn.disabled = false; });
    }
}

async function onOfferDrawClick() {
    if (!currentGameId || !gameInProgress) return;
    const btn = document.getElementById('btn-offer-draw');
    if (!btn) return;
    btn.disabled = true;
    try {
        await apiFetch(`/api/live/draw/${encodeURIComponent(currentGameId)}`, { method: 'POST' });
        btn.textContent = t('live.drawOffered');
        setTimeout(() => {
            if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6v12M16 6v12M4 12h16"/></svg> ${t('live.offerDraw')}`;
        }, 3000);
    } catch (e) {
        console.error('Draw offer error:', e);
    } finally {
        btn.disabled = false;
    }
}

// ─── Utilities ───────────────────────────────────────────────────

function findMoveClassification(moveNumber, color) {
    const move = moves.find(m => m.move_number === moveNumber && m.color === color);
    return move?.classification || 'good';
}

function classificationBadge(cls) {
    const labels = {
        brilliant: '!!',
        great: '!',
        good: '',
        inaccuracy: '?!',
        mistake: '?',
        blunder: '??',
    };
    if (!labels[cls] && cls !== 'good') return '';
    if (cls === 'good') return '';
    return `<span class="badge badge-${cls}">${labels[cls] || cls}</span>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function escapeAttr(text) {
    return (text || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/^### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^## (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<br>\s*(<h[45]>)/g, '$1');
    html = html.replace(/(<\/h[45]>)\s*<br>/g, '$1');
    html = html.replace(/<br>\s*(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)\s*<br>/g, '$1');
    return html;
}

function showEl(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
}

function hideEl(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}
