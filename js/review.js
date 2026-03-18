/**
 * Review page — replay a game with move-by-move analysis + AI coaching.
 */

import { Chessground } from '/static/vendor/chessground.min.js';
import { EvalBar } from './eval-bar.js';
import { t, getLang } from './i18n.js';
import { apiFetch } from './api.js';
import { isFreeUser } from './user-state.js';
import { showUpgradeModal } from './upgrade-modal.js';
import { setAIContext } from './ai-widget.js';
import { showGameEndOverlay, clearGameEndOverlay } from './components/game-end-overlay.js';
import { initZoneDrag, destroyZoneDrag, openReorderModal, resetLayout, saveLayout, notifyContentChange } from './zone-drag.js';

let ground = null;
let evalBar = null;
let evalChart = null;
let gameData = null;
let currentMoveIndex = -1;
let autoPlayTimer = null;
let previewIndex = null; // non-null when previewing a move from Q&A
let _themeChangeHandler = null;
let _zoneDrag = null;
let _boardOrientation = 'white'; // current board orientation for flip

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

export async function render(container, gameId) {
    container.innerHTML = `
        <div class="review-page">
            <div class="review-header" id="review-header">
                <div class="spinner"></div>
            </div>
            <div class="review-content" id="review-zones-container">
                <div class="zone-wrap" data-zone-id="board">
                    <div class="review-board-section">
                        <div class="eval-bar-container" id="review-eval-bar"></div>
                        <div class="cg-wrap" id="review-board" aria-label="${t('review.chessBoard')}" role="img"></div>
                    </div>
                </div>
                <div class="zone-wrap" data-zone-id="moves">
                    <div class="review-moves card bg-base-200" id="review-moves"></div>
                </div>
                <div class="zone-wrap" data-zone-id="controls">
                    <div class="review-controls" role="toolbar" aria-label="${t('review.moveControls')}">
                        <div class="join">
                            <button class="btn btn-sm join-item" id="btn-start" aria-label="${t('review.firstMove')}">&#9198;</button>
                            <button class="btn btn-sm join-item" id="btn-prev" aria-label="${t('review.prevMove')}">&#9664;</button>
                            <button class="btn btn-sm join-item" id="btn-play" title="Play/Pause" aria-label="${t('review.autoPlay')}">&#9205;</button>
                            <button class="btn btn-sm join-item" id="btn-next" aria-label="${t('review.nextMove')}">&#9654;</button>
                            <button class="btn btn-sm join-item" id="btn-end" aria-label="${t('review.lastMove')}">&#9197;</button>
                        </div>
                        <button class="btn btn-sm btn-ghost" id="btn-flip" aria-label="${t('review.flipBoard') || 'Retourner le plateau'}" title="${t('review.flipBoard') || 'Retourner le plateau'}">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 11l3 3 3-3"/><path d="M5 14V6"/><path d="M14 5l-3-3-3 3"/><path d="M11 2v8"/></svg>
                        </button>
                    </div>
                </div>
                <div class="zone-wrap" data-zone-id="coach">
                    <div class="review-coach card bg-base-200" id="review-comment" aria-live="polite">
                        <div class="coach-header">
                            <div class="coach-icon">&#9822;</div>
                            <span class="coach-title">${t('review.coachIA')}</span>
                        </div>
                        <p class="no-comment opacity-60">${t('review.selectMove')}</p>
                    </div>
                </div>
                <div class="zone-wrap" data-zone-id="chart">
                    <div class="card bg-base-200 chart-container" aria-label="${t('review.evalChart')}">
                        <canvas id="review-eval-chart"></canvas>
                    </div>
                </div>
                <div class="zone-wrap" data-zone-id="summary">
                    <div class="review-summary card bg-base-200" id="review-summary"></div>
                </div>
            </div>
        </div>
    `;

    // Load game data
    try {
        const resp = await apiFetch(`/api/games/${gameId}`);
        if (!resp.ok) throw new Error('Game not found');
        gameData = await resp.json();
    } catch (e) {
        container.innerHTML = `<div class="card bg-base-200"><div class="card-body"><p>${t('review.gameNotFound')}</p><a href="#games" class="btn btn-sm btn-ghost mt-2">${t('review.back')}</a></div></div>`;
        return;
    }

    // Auto-repair incomplete games (no result = stream was interrupted)
    const g = gameData.game;
    if (!g.result || g.result === '' || g.result === '*') {
        try {
            const rr = await apiFetch(`/api/games/${gameId}/repair`, { method: 'POST' });
            if (rr.ok) {
                const freshResp = await apiFetch(`/api/games/${gameId}`);
                if (freshResp.ok) gameData = await freshResp.json();
            }
        } catch (_) { /* silent — show what we have */ }
    }

    const game = gameData.game;

    // Set AI widget context for this game
    const aiCtx = [
        `Game review: ${game.our_color === 'w' ? 'White' : 'Black'} vs ${game.opponent || '?'}`,
        `Result: ${game.result || '?'}`,
        game.opening_name ? `Opening: ${game.opening_name}` : '',
        game.accuracy_pct != null ? `Accuracy: ${game.accuracy_pct}%` : '',
        game.pgn ? `PGN: ${game.pgn.substring(0, 500)}` : '',
    ].filter(Boolean).join(', ');
    setAIContext(aiCtx);

    // Init board
    _boardOrientation = game.our_color === 'w' ? 'white' : 'black';
    ground = Chessground(document.getElementById('review-board'), {
        orientation: _boardOrientation,
        viewOnly: true,
        coordinates: true,
        ranksPosition: 'left',
        animation: { duration: 200 },
    });

    // Init eval bar
    evalBar = new EvalBar(document.getElementById('review-eval-bar'));
    evalBar.setOrientation(_boardOrientation);

    // Back button for friend games
    if (game.is_friend_game && game.friend_username) {
        const navEl = document.createElement('div');
        navEl.className = 'review-friend-nav';
        navEl.innerHTML = `
            <a href="#friend/${encodeURIComponent(game.friend_username)}" class="btn btn-ghost btn-sm gap-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
                ${t('review.backToFriend', { username: escapeHtml(game.friend_username) })}
            </a>
        `;
        const reviewPage = container.querySelector('.review-page');
        if (reviewPage) reviewPage.prepend(navEl);
    }

    // Render header
    const headerEl = document.getElementById('review-header');
    headerEl.innerHTML = buildReviewHeaderHtml(game);

    // Analyse button (if no analysis yet)
    const analyseBtn = document.getElementById('btn-analyse');
    if (analyseBtn) {
        analyseBtn.addEventListener('click', () => runAnalysis(gameId, analyseBtn));
    }

    // Build move list
    buildMoveList();

    // Build eval chart
    buildEvalChart();

    // AI summary — or trigger coach if Stockfish done but no summary
    if (game.ai_summary) {
        renderSummary(game.ai_summary);
    } else if (game.accuracy_pct != null) {
        // Stockfish done but no coach summary — check if coaching is in progress
        checkAndOfferCoaching(gameId);
    }

    // Listen for theme changes to re-render eval chart
    _themeChangeHandler = async () => {
        if (evalChart) { evalChart.destroy(); evalChart = null; }
        await buildEvalChart();
    };
    window.addEventListener('themechange', _themeChangeHandler);

    // Controls
    document.getElementById('btn-start').addEventListener('click', () => { stopAutoPlay(); goToMove(-1); });
    document.getElementById('btn-prev').addEventListener('click', () => { stopAutoPlay(); goToMove(currentMoveIndex - 1); });
    document.getElementById('btn-play').addEventListener('click', toggleAutoPlay);
    document.getElementById('btn-next').addEventListener('click', () => { stopAutoPlay(); goToMove(currentMoveIndex + 1); });
    document.getElementById('btn-end').addEventListener('click', () => { stopAutoPlay(); goToMove(gameData.moves.length - 1); });
    document.getElementById('btn-flip').addEventListener('click', flipBoard);

    // Keyboard navigation
    document.addEventListener('keydown', onKeyDown);

    // Zone drag — positionnement libre (si activé par l'admin)
    const defaultOrder = ['board', 'moves', 'controls', 'coach', 'chart', 'summary'];
    try {
        const meResp = await apiFetch('/api/auth/me');
        const meData = meResp.ok ? await meResp.json() : {};
        const layoutEnabled = meData.layout_customization_enabled !== false;
        const layoutPrefs = meData.layout_preferences || {};
        const reviewPrefs = layoutPrefs.review || {};

        const zonesContainer = container.querySelector('#review-zones-container');
        if (zonesContainer && layoutEnabled) {
            _zoneDrag = initZoneDrag({
                page: 'review',
                container: zonesContainer,
                defaultOrder,
                savedPositions: reviewPrefs.positions || null,
                savedOrder: reviewPrefs.order || null,
            });
            const customizeBtn = container.querySelector('.review-customize-btn');
            if (customizeBtn) {
                customizeBtn.addEventListener('click', () => openReorderModal(_zoneDrag));
            }
            const saveBtn = container.querySelector('.review-save-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => saveLayout(_zoneDrag));
            }
            const resetBtn = container.querySelector('.review-reset-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => resetLayout(_zoneDrag));
            }
        } else {
            // Masquer les boutons si désactivé
            container.querySelector('.rh-layout-actions')?.remove();
            container.querySelector('#review-zones-container')?.classList.add('layout-locked');
        }
    } catch (_) { /* zone-drag non-critique */ }

    // Réappliquer height:auto sur le résumé après initZoneDrag
    // (initZoneDrag applique la hauteur sauvegardée qui peut être trop petite pour ce résumé)
    if (game.ai_summary && _zoneDrag) {
        const summaryWrap = container.querySelector('[data-zone-id="summary"]');
        if (summaryWrap) summaryWrap.style.height = 'auto';
        notifyContentChange(_zoneDrag);
    }

    // Start at beginning
    goToMove(-1);
}

export function destroy() {
    stopAutoPlay();
    previewIndex = null;
    document.removeEventListener('keydown', onKeyDown);
    if (_themeChangeHandler) {
        window.removeEventListener('themechange', _themeChangeHandler);
        _themeChangeHandler = null;
    }
    if (_zoneDrag) { destroyZoneDrag(_zoneDrag); _zoneDrag = null; }
    if (ground) { ground.destroy(); ground = null; }
    if (evalChart) { evalChart.destroy(); evalChart = null; }
    gameData = null;
    currentMoveIndex = -1;
    setAIContext('');
}

function flipBoard() {
    _boardOrientation = _boardOrientation === 'white' ? 'black' : 'white';
    if (ground) ground.set({ orientation: _boardOrientation });
    if (evalBar) evalBar.setOrientation(_boardOrientation);
}

function onKeyDown(e) {
    // Don't capture keys when typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Escape' && previewIndex !== null) { exitPreview(); return; }
    if (e.key === 'ArrowLeft') { stopAutoPlay(); goToMove(currentMoveIndex - 1); }
    else if (e.key === 'ArrowRight') { stopAutoPlay(); goToMove(currentMoveIndex + 1); }
    else if (e.key === 'Home') { stopAutoPlay(); goToMove(-1); }
    else if (e.key === 'End' && gameData) { stopAutoPlay(); goToMove(gameData.moves.length - 1); }
    else if (e.key === ' ') { e.preventDefault(); toggleAutoPlay(); }
}

function toggleAutoPlay() {
    if (autoPlayTimer) {
        stopAutoPlay();
    } else {
        startAutoPlay();
    }
}

function startAutoPlay() {
    if (!gameData) return;
    const playBtn = document.getElementById('btn-play');
    if (playBtn) playBtn.innerHTML = '&#9208;'; // pause icon
    // If at end, restart from beginning
    if (currentMoveIndex >= gameData.moves.length - 1) {
        goToMove(-1);
    }
    autoPlayTimer = setInterval(() => {
        if (!gameData || currentMoveIndex >= gameData.moves.length - 1) {
            stopAutoPlay();
            return;
        }
        goToMove(currentMoveIndex + 1);
    }, 700);
}

function stopAutoPlay() {
    if (autoPlayTimer) {
        clearInterval(autoPlayTimer);
        autoPlayTimer = null;
    }
    const playBtn = document.getElementById('btn-play');
    if (playBtn) playBtn.innerHTML = '&#9205;'; // play icon
}

function goToMove(index) {
    if (!gameData) return;
    index = Math.max(-1, Math.min(index, gameData.moves.length - 1));
    currentMoveIndex = index;

    const boardEl = document.getElementById('review-board');

    if (index === -1) {
        // Starting position
        ground.set({ fen: 'start', lastMove: undefined, check: false });
        evalBar.reset();
        updateComment(null);
        notifyContentChange(_zoneDrag);
        clearGameEndOverlay(boardEl);
    } else {
        const move = gameData.moves[index];

        // Detect check from FEN
        let checkColor = false;
        try {
            const temp = new Chess(move.fen_after);
            if (temp.in_check()) checkColor = temp.turn() === 'w' ? 'white' : 'black';
        } catch { /* ignore */ }

        ground.set({
            fen: move.fen_after,
            lastMove: [move.uci.slice(0, 2), move.uci.slice(2, 4)],
            check: checkColor,
        });

        // Show best move arrow for errors
        if (move.best_move_uci && move.classification !== 'good' && move.classification !== 'great' && move.classification !== 'brilliant') {
            ground.setAutoShapes([{
                orig: move.best_move_uci.slice(0, 2),
                dest: move.best_move_uci.slice(2, 4),
                brush: 'green',
            }]);
        } else {
            ground.setAutoShapes([]);
        }

        evalBar.update(move.eval_after_cp);
        updateComment(move);
        notifyContentChange(_zoneDrag);

        // Game-end overlay on last move
        const game = gameData.game;
        const isLastMove = index === gameData.moves.length - 1;
        // Convert DB result (win/loss/draw) to PGN notation (1-0/0-1/1/2-1/2)
        let pgnResult = game.result;
        if (pgnResult === 'win')       pgnResult = game.our_color === 'w' ? '1-0' : '0-1';
        else if (pgnResult === 'loss') pgnResult = game.our_color === 'w' ? '0-1' : '1-0';
        else if (pgnResult === 'draw') pgnResult = '1/2-1/2';
        if (isLastMove && pgnResult && pgnResult !== '*' && pgnResult !== '1/2-1/2') {
            // Detect cause: if last eval is mate → checkmate, else resignation/timeout
            const isMate = move.eval_after_mate != null || (move.eval_after_cp != null && Math.abs(move.eval_after_cp) > 9000);
            const cause = isMate ? 'checkmate' : 'resignation';
            const orientation = game.our_color === 'w' ? 'white' : 'black';
            showGameEndOverlay(boardEl, move.fen_after, pgnResult, cause, orientation);
        } else {
            clearGameEndOverlay(boardEl);
        }
    }

    // Highlight current move in list
    highlightMove(index);

    // Update chart cursor
    if (evalChart && index >= 0) {
        evalChart.setActiveElements([{ datasetIndex: 0, index }]);
        evalChart.update('none');
    }

    // Clear any preview state
    exitPreview(true);
}

/** Preview a move on the board WITHOUT changing the current move or rebuilding the comment panel. */
function previewMove(index) {
    if (!gameData || index < 0 || index >= gameData.moves.length) return;
    const move = gameData.moves[index];
    previewIndex = index;

    // Update board visually
    ground.set({
        fen: move.fen_after,
        lastMove: [move.uci.slice(0, 2), move.uci.slice(2, 4)],
    });
    if (move.best_move_uci && move.classification !== 'good' && move.classification !== 'great' && move.classification !== 'brilliant') {
        ground.setAutoShapes([{
            orig: move.best_move_uci.slice(0, 2),
            dest: move.best_move_uci.slice(2, 4),
            brush: 'green',
        }]);
    } else {
        ground.setAutoShapes([]);
    }
    evalBar.update(move.eval_after_cp);
}

/** Exit preview mode and restore the actual current move on the board. */
function exitPreview(silent) {
    if (previewIndex === null) return;
    previewIndex = null;

    if (silent) return; // goToMove already handles restoring

    // Restore actual current move on the board
    if (currentMoveIndex === -1) {
        ground.set({ fen: 'start', lastMove: undefined });
        ground.setAutoShapes([]);
        evalBar.reset();
    } else {
        const move = gameData.moves[currentMoveIndex];
        ground.set({
            fen: move.fen_after,
            lastMove: [move.uci.slice(0, 2), move.uci.slice(2, 4)],
        });
        if (move.best_move_uci && move.classification !== 'good' && move.classification !== 'great' && move.classification !== 'brilliant') {
            ground.setAutoShapes([{
                orig: move.best_move_uci.slice(0, 2),
                dest: move.best_move_uci.slice(2, 4),
                brush: 'green',
            }]);
        } else {
            ground.setAutoShapes([]);
        }
        evalBar.update(move.eval_after_cp);
    }
}

function buildMoveList() {
    const movesEl = document.getElementById('review-moves');
    if (!movesEl || !gameData) return;

    let html = '<div class="move-list">';
    for (let i = 0; i < gameData.moves.length; i++) {
        const m = gameData.moves[i];
        if (m.color === 'w') {
            html += `<div class="move-row" data-index="${i}">`;
            html += `<span class="move-number">${m.move_number}.</span>`;
            html += `<span class="move white-move clickable ${m.classification}" data-idx="${i}">${m.san}</span>`;
        }
        if (m.color === 'b') {
            html += `<span class="move black-move clickable ${m.classification}" data-idx="${i}">${m.san}</span>`;
            html += `</div>`;
        }
        // Handle odd last move (white move with no black response)
        if (m.color === 'w' && i === gameData.moves.length - 1) {
            html += `</div>`;
        }
    }
    html += '</div>';
    movesEl.innerHTML = html;

    // Click handlers
    movesEl.querySelectorAll('.clickable').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.idx);
            if (!isNaN(idx)) goToMove(idx);
        });
    });
}

function highlightMove(index) {
    const movesEl = document.getElementById('review-moves');
    if (!movesEl) return;
    movesEl.querySelectorAll('.move.active').forEach(el => el.classList.remove('active'));
    if (index >= 0) {
        const el = movesEl.querySelector(`.move[data-idx="${index}"]`);
        if (el) {
            el.classList.add('active');
            // Scroller uniquement le conteneur de coups, pas la page
            const scrollParent = el.closest('[data-zone-id="moves"]');
            if (scrollParent) {
                const rect = el.getBoundingClientRect();
                const parentRect = scrollParent.getBoundingClientRect();
                if (rect.top < parentRect.top) {
                    scrollParent.scrollTop -= (parentRect.top - rect.top);
                } else if (rect.bottom > parentRect.bottom) {
                    scrollParent.scrollTop += (rect.bottom - parentRect.bottom);
                }
            } else {
                el.scrollIntoView({ block: 'nearest' });
            }
        }
    }
}

function updateComment(move) {
    const commentEl = document.getElementById('review-comment');
    if (!commentEl) return;

    if (!move) {
        commentEl.innerHTML = `
            <div class="coach-header">
                <div class="coach-icon">&#9822;</div>
                <span class="coach-title">${t('review.coachIA')}</span>
            </div>
            <p class="no-comment opacity-60">${t('review.selectMove')}</p>
        `;
        return;
    }

    const classLabel = {
        'brilliant': t('class.brilliant'),
        'great': t('class.great'),
        'good': t('class.good'),
        'inaccuracy': t('class.inaccuracy'),
        'mistake': t('class.mistake'),
        'blunder': t('class.blunder'),
    };

    const badge = move.classification !== 'good' ?
        `<span class="badge badge-${move.classification}">${classLabel[move.classification] || move.classification}</span>` : '';
    const cpLoss = move.centipawn_loss > 0 ? `<span class="cp-loss">(-${(move.centipawn_loss / 100).toFixed(1)})</span>` : '';
    const moveLabel = move.color === 'w' ? `${move.move_number}.` : `${move.move_number}...`;

    const hasAnalysis = move.eval_before_cp != null;
    let askHtml = '';
    if (hasAnalysis) {
        if (isFreeUser()) {
            askHtml = `
                <div class="upsell-banner" style="margin-top:12px;">
                    <span>${t('upsell.reviewAskClaude')}</span>
                    <button class="btn btn-sm" id="review-upsell-ask">${t('subscription.upgrade')}</button>
                </div>
            `;
        } else {
            askHtml = `
                <div class="coach-ask">
                    <div class="coach-ask-input flex gap-2 mt-2">
                        <input type="text" class="input input-bordered input-sm flex-1" placeholder="${t('review.askPlaceholder')}" id="coach-ask-input">
                        <button class="btn btn-sm btn-primary" id="coach-ask-btn">${t('review.askSend')}</button>
                    </div>
                    <div id="coach-answers"></div>
                </div>
            `;
        }
    }

    commentEl.innerHTML = `
        <div class="coach-header">
            <div class="coach-icon">&#9822;</div>
            <span class="coach-title">${t('review.coachIA')}</span>
            ${badge}
        </div>
        <div class="move-info">
            <span class="move-played">${moveLabel} ${move.san}</span>
            ${cpLoss}
            ${move.best_move_san && move.classification !== 'good' && move.classification !== 'great' && move.classification !== 'brilliant' ?
                `<span class="best-move">${t('review.bestMove')} ${move.best_move_san}</span>` : ''}
        </div>
        ${move.ai_comment ?
            `<div class="coach-text">${escapeHtml(move.ai_comment)}</div>` :
            (move.classification === 'good' ?
                `<div class="coach-text" style="color: var(--accent);">${t('review.goodMove')}</div>` :
                `<p class="no-comment">${t('review.noComment')}</p>`
            )
        }
        ${askHtml}
    `;

    // Auto-expand : laisser le module grandir avec le contenu
    const coachWrapper = commentEl.closest('[data-zone-id="coach"]');
    if (coachWrapper) coachWrapper.style.height = 'auto';

    // Attach Q&A handlers
    if (hasAnalysis) {
        if (isFreeUser()) {
            document.getElementById('review-upsell-ask')?.addEventListener('click', () => {
                showUpgradeModal('ai_coaching');
            });
        } else {
            const askInput = document.getElementById('coach-ask-input');
            const askBtn = document.getElementById('coach-ask-btn');
            if (askInput && askBtn) {
                const submitQuestion = () => askCoachAboutMove(move, askInput, askBtn);
                askBtn.addEventListener('click', submitQuestion);
                askInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') submitQuestion();
                });
            }
        }
    }
}

// Map French/Spanish piece letters to English SAN
const _pieceTo = { 'R': 'K', 'D': 'Q', 'T': 'R', 'F': 'B', 'C': 'N',  // FR
                        'A': 'B', 'C': 'N' };  // ES (Caballo=N, Alfil=B)
function _normSan(san) {
    let s = (san || '').replace(/[+#!?=]/g, '');
    // Translate first letter if it's a non-English piece letter
    if (s.length >= 2 && /^[RDTFCA]/.test(s) && _pieceTo[s[0]]) {
        s = _pieceTo[s[0]] + s.slice(1);
    }
    return s;
}

function findMoveBySan(san) {
    if (!gameData || !gameData.moves) return -1;
    const norm = _normSan(san);
    let bestIdx = -1, bestDist = Infinity;
    gameData.moves.forEach((m, i) => {
        const mSan = (m.san || '').replace(/[+#!?=]/g, '');
        if (mSan === norm) {
            const dist = Math.abs(i - currentMoveIndex);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
    });
    return bestIdx;
}

function attachMoveRefs(container) {
    if (!container) return;
    container.querySelectorAll('.move-ref').forEach(el => {
        el.addEventListener('click', () => {
            if (!gameData) return;
            let idx = -1;
            // By move number
            const moveNum = parseInt(el.dataset.moveNum);
            if (!isNaN(moveNum)) {
                const color = el.dataset.color;
                idx = gameData.moves.findIndex(m => {
                    if (m.move_number !== moveNum) return false;
                    if (color) return m.color === color;
                    return true;
                });
            }
            // By SAN
            if (idx < 0 && el.dataset.san) {
                idx = findMoveBySan(el.dataset.san);
            }
            if (idx >= 0) {
                stopAutoPlay();
                goToMove(idx);
            }
        });
    });
}

function renderSummary(aiSummary) {
    const summaryEl = document.getElementById('review-summary');
    if (!summaryEl) return;
    const wrapper = summaryEl.closest('[data-zone-id="summary"]') || summaryEl;

    if (aiSummary) {
        summaryEl.innerHTML = `
            <div class="summary-header">
                <span style="font-size: 1.1rem;">&#9822;</span>
                <h4>${t('review.coachAnalysis')}</h4>
            </div>
            <div class="summary-content">${formatMarkdown(aiSummary)}</div>
        `;
        wrapper.style.display = '';
        // Auto-expand : supprimer la hauteur fixe pour que le contenu s'affiche entièrement
        wrapper.style.height = 'auto';
        attachMoveRefs(summaryEl);
    } else {
        wrapper.style.display = 'none';
    }
}

async function buildEvalChart() {
    if (!gameData || !gameData.moves.length) return;
    const canvas = document.getElementById('review-eval-chart');
    if (!canvas) return;
    // Détruire l'ancien chart avant d'en créer un nouveau
    if (evalChart) { evalChart.destroy(); evalChart = null; }
    try {
        await ensureChartJS();
    } catch (e) {
        console.warn('Chart.js load failed:', e);
        return;
    }
    if (typeof Chart === 'undefined') return;

    const labels = gameData.moves.map(m =>
        `${m.color === 'w' ? m.move_number + '.' : m.move_number + '...'} ${m.san}`
    );
    const evals = gameData.moves.map(m => {
        if (m.eval_after_cp != null) return Math.max(-500, Math.min(500, m.eval_after_cp)) / 100;
        return 0;
    });

    const accent = getCssVar('--color-primary') || getCssVar('--accent') || '#c9a84c';
    const accentAlpha = accent.startsWith('#')
        ? hexToRgba(accent, 0.1)
        : 'rgba(201,168,76,0.1)';
    const accentLine = accent.startsWith('#')
        ? hexToRgba(accent, 0.35)
        : 'rgba(201,168,76,0.35)';
    const accentGrid = accent.startsWith('#')
        ? hexToRgba(accent, 0.08)
        : 'rgba(201,168,76,0.08)';
    const baseContent = getCssVar('--color-base-content') || '#9a8e7e';
    const textMuted = baseContent.startsWith('#') ? hexToRgba(baseContent, 0.6) : baseContent;

    const colors = gameData.moves.map(m => {
        const cls = m.classification;
        if (cls === 'blunder') return getCssVar('--move-blunder') || getCssVar('--color-error') || '#c0392b';
        if (cls === 'mistake') return getCssVar('--move-mistake') || '#e67e22';
        if (cls === 'inaccuracy') return getCssVar('--move-inaccuracy') || getCssVar('--color-warning') || '#d4a017';
        if (cls === 'brilliant') return getCssVar('--move-brilliant') || '#00e5ff';
        if (cls === 'great') return getCssVar('--move-great') || '#5b8bb6';
        return accent;
    });

    const evalZonesPlugin = {
        id: 'evalZones',
        beforeDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales.y) return;
            const yAxis = scales.y;
            const zeroY = yAxis.getPixelForValue(0);
            const top = chartArea.top;
            const bottom = chartArea.bottom;
            const left = chartArea.left;
            const right = chartArea.right;
            const clampedZero = Math.max(top, Math.min(bottom, zeroY));

            // White zone (positive eval = white advantage)
            ctx.save();
            ctx.fillStyle = 'rgba(245, 240, 232, 0.07)';
            ctx.fillRect(left, top, right - left, clampedZero - top);

            // Black zone (negative eval = black advantage)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
            ctx.fillRect(left, clampedZero, right - left, bottom - clampedZero);

            // Zero line separator
            ctx.strokeStyle = accentLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(left, clampedZero);
            ctx.lineTo(right, clampedZero);
            ctx.stroke();
            ctx.restore();
        }
    };

    evalChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: t('review.evalPawns'),
                data: evals,
                borderColor: accent,
                backgroundColor: accentAlpha,
                pointBackgroundColor: colors,
                pointRadius: 3,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.2,
            }],
        },
        plugins: [evalZonesPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 6, bottom: 6 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const move = gameData.moves[ctx.dataIndex];
                            return `${move.san}: ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y.toFixed(1)} (${move.classification})`;
                        },
                    },
                },
            },
            scales: {
                y: {
                    min: -5, max: 5,
                    grid: { color: accentGrid },
                    ticks: { color: textMuted, stepSize: 1 },
                },
                x: {
                    grid: { display: false },
                    ticks: { display: false },
                },
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    goToMove(elements[0].index);
                }
            },
        },
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^## (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^# (.+)$/gm, '<h3>$1</h3>');

    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    html = html.replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>');

    // Make move references clickable
    // Pattern 1: "coup N" (FR), "move N" (EN), "jugada N" (ES)
    html = html.replace(/\b(coup|move|jugada)\s+(\d{1,3})\b/gi, (match, word, num) => {
        return `<span class="move-ref" data-move-num="${num}">${word} ${num}</span>`;
    });
    // Pattern 2: "N." or "N..." followed by SAN (e.g. "25. fxg3", "14... Kh7")
    html = html.replace(/\b(\d{1,3})(\.{1,3})\s*([A-Za-z][a-hx]?\w*[+#!?=]*)/g, (match, num, dots, san) => {
        return `<span class="move-ref" data-move-num="${num}" data-color="${dots.length >= 3 ? 'b' : 'w'}">${num}${dots} ${san}</span>`;
    });
    // Pattern 3: Standalone SAN moves — EN: KQRBN, FR: RDTFC, ES: RDTAC
    // Skip text already inside <span> tags to avoid double-wrapping
    html = html.replace(
        /(<span\b[^>]*>[\s\S]*?<\/span>)|(<[^>]+>)|\b([KQRBNDTFCArdtfca][a-h]?[1-8]?x?[a-h][1-8][+#!?=]*|[a-h]x[a-h][1-8](?:=[KQRBN])?[+#!?=]*|O-O(?:-O)?[+#!?=]*)\b/g,
        (match, span, tag, san) => {
            if (span || tag) return match;
            return `<span class="move-ref" data-san="${san.replace(/[+#!?=]/g, '')}">${san}</span>`;
        }
    );

    // Newlines
    html = html.replace(/\n/g, '<br>');

    // Clean up <br> around block elements
    html = html.replace(/<br>\s*(<h[345]>)/g, '$1');
    html = html.replace(/(<\/h[345]>)\s*<br>/g, '$1');
    html = html.replace(/<br>\s*(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)\s*<br>/g, '$1');

    return html;
}

async function askCoachAboutMove(move, inputEl, btnEl) {
    const question = inputEl.value.trim();
    if (!question) return;

    const answersEl = document.getElementById('coach-answers');
    if (!answersEl) return;

    // Disable input
    inputEl.disabled = true;
    btnEl.disabled = true;
    btnEl.textContent = t('review.askThinking');

    // Show the question immediately
    const itemEl = document.createElement('div');
    itemEl.className = 'coach-answer-item';
    itemEl.innerHTML = `<div class="coach-answer-q">${escapeHtml(question)}</div><div class="coach-answer-a"><em>${t('review.askThinking')}</em></div>`;
    answersEl.prepend(itemEl);

    try {
        const gameId = gameData.game.id;
        const resp = await apiFetch(`/api/games/${gameId}/moves/${move.id}/ask`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept-Language': getLang(),
            },
            body: JSON.stringify({ question }),
        });
        if (!resp.ok) throw new Error('Ask failed');
        const data = await resp.json();
        const answerDiv = itemEl.querySelector('.coach-answer-a');
        answerDiv.innerHTML = formatMarkdown(data.response);
        attachMoveRefs(answerDiv);
        // Auto-expand le module coach pour montrer la réponse complète
        const coachWrapper = answersEl.closest('[data-zone-id="coach"]');
        if (coachWrapper) coachWrapper.style.height = 'auto';
    } catch (e) {
        itemEl.querySelector('.coach-answer-a').innerHTML = `<em style="color:var(--danger);">${t('review.askError')}</em>`;
    }

    // Re-enable
    inputEl.value = '';
    inputEl.disabled = false;
    btnEl.disabled = false;
    btnEl.textContent = t('review.askSend');
    inputEl.focus();
}

async function checkAndOfferCoaching(gameId) {
    const summaryEl = document.getElementById('review-summary');
    if (!summaryEl) return;
    const wrapper = summaryEl.closest('[data-zone-id="summary"]') || summaryEl;

    // Check if coaching is already in progress
    try {
        const resp = await apiFetch(`/api/games/${gameId}/analysis-status`);
        if (resp.ok) {
            const status = await resp.json();
            if (status.coaching_in_progress) {
                // Show spinner and poll
                summaryEl.innerHTML = `
                    <div class="summary-header">
                        <span style="font-size: 1.1rem;">&#9822;</span>
                        <h4>${t('review.coachAnalysis')}</h4>
                    </div>
                    <div class="summary-content">
                        <div class="coach-generating"><div class="spinner-small"></div> ${t('review.coachGenerating')}</div>
                    </div>`;
                wrapper.style.display = '';
                await pollCoachingStatus(gameId);
                return;
            }
        }
    } catch (e) { /* ignore */ }

    // Offer button to generate coach analysis
    summaryEl.innerHTML = `
        <div class="summary-header">
            <span style="font-size: 1.1rem;">&#9822;</span>
            <h4>${t('review.coachAnalysis')}</h4>
        </div>
        <div class="summary-content">
            <button class="btn btn-coach-generate" id="btn-generate-coach">
                <span>&#9822;</span> ${t('review.generateCoach')}
            </button>
        </div>`;
    wrapper.style.display = '';

    document.getElementById('btn-generate-coach').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner-small"></div> ${t('review.coachGenerating')}`;

        try {
            const resp = await apiFetch(`/api/games/${gameId}/coach`, {
                method: 'POST',
                headers: { 'Accept-Language': getLang() },
            });
            if (!resp.ok) throw new Error('Coach failed');
            const data = await resp.json();

            if (data.coaching_launched) {
                // Poll for coaching completion
                await pollCoachingResult(gameId, summaryEl);
            } else {
                // Refresh game data
                const gameResp = await apiFetch(`/api/games/${gameId}`);
                if (gameResp.ok) {
                    const freshData = await gameResp.json();
                    gameData.game.ai_summary = freshData.game.ai_summary;
                    gameData.moves = freshData.moves;
                    renderSummary(freshData.game.ai_summary);
                    goToMove(currentMoveIndex);
                }
            }
        } catch (err) {
            btn.disabled = false;
            btn.innerHTML = `<span>&#9822;</span> ${t('review.generateCoach')}`;
            summaryEl.querySelector('.summary-content').insertAdjacentHTML('beforeend',
                `<p class="error-text" style="margin-top:8px;">${t('review.coachError')}</p>`);
        }
    });
}

async function pollCoachingResult(gameId, summaryEl) {
    const maxPolls = 60; // 3 minutes max
    for (let i = 0; i < maxPolls; i++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
            const resp = await apiFetch(`/api/games/${gameId}/analysis-status`);
            if (!resp.ok) continue;
            const status = await resp.json();

            if (status.coaching_done) {
                const gameResp = await apiFetch(`/api/games/${gameId}`);
                if (gameResp.ok) {
                    const freshData = await gameResp.json();
                    gameData.game.ai_summary = freshData.game.ai_summary;
                    gameData.moves = freshData.moves;
                    if (freshData.game.ai_summary) {
                        renderSummary(freshData.game.ai_summary);
                    } else {
                        // Coaching finished but no summary generated
                        if (summaryEl) {
                            summaryEl.innerHTML = `
                                <div class="summary-header">
                                    <span style="font-size: 1.1rem;">&#9822;</span>
                                    <h4>${t('review.coachAnalysis')}</h4>
                                </div>
                                <div class="summary-content">
                                    <p class="error-text">${t('review.coachError')}</p>
                                </div>`;
                        }
                    }
                    goToMove(currentMoveIndex);
                }
                return;
            }
        } catch (e) { /* continue polling */ }
    }
    // Timeout
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="summary-header">
                <span style="font-size: 1.1rem;">&#9822;</span>
                <h4>${t('review.coachAnalysis')}</h4>
            </div>
            <div class="summary-content">
                <p class="error-text">${t('review.analysisTimeout')}</p>
            </div>`;
    }
}

async function runAnalysis(gameId, btn) {
    // Insert progress card below the header
    const headerEl = document.getElementById('review-header');
    if (!headerEl) return;

    const progressHtml = `
        <div class="analysis-progress" id="analysis-progress" style="margin-top:16px;">
            <div class="analysis-phase active" id="phase-stockfish">
                <div class="phase-icon"><div class="spinner-small"></div></div>
                <div class="phase-text">
                    <div class="phase-title">${t('review.stockfishAnalysis')}</div>
                    <div class="phase-desc">${t('review.evaluatingMoves')}</div>
                </div>
            </div>
            <div class="analysis-phase pending" id="phase-coach">
                <div class="phase-icon"><span class="phase-dot"></span></div>
                <div class="phase-text">
                    <div class="phase-title">${t('review.coachAnalysisPhase')}</div>
                    <div class="phase-desc">${t('review.waiting')}</div>
                </div>
            </div>
        </div>
    `;
    btn.style.display = 'none';
    headerEl.insertAdjacentHTML('afterend', progressHtml);

    try {
        // Launch analysis (returns immediately, runs in background)
        const resp = await apiFetch(`/api/games/${gameId}/analyse`, {
            method: 'POST',
            headers: { 'Accept-Language': getLang() },
        });
        if (!resp.ok) {
            let errMsg = 'Analysis failed';
            try { const err = await resp.json(); errMsg = err.detail || errMsg; } catch (_) {}
            throw new Error(errMsg);
        }

        // Poll for Stockfish completion
        const maxPolls = 120; // 6 minutes max (120 * 3s)
        let stockfishDone = false;
        for (let i = 0; i < maxPolls; i++) {
            await new Promise(r => setTimeout(r, 3000));
            try {
                const statusResp = await apiFetch(`/api/games/${gameId}/analysis-status`);
                if (!statusResp.ok) continue;
                const status = await statusResp.json();

                if (status.error) throw new Error(status.error);

                if (status.stockfish_done && !stockfishDone) {
                    stockfishDone = true;
                    // Stockfish done — update UI
                    const phaseStockfish = document.getElementById('phase-stockfish');
                    if (phaseStockfish) {
                        phaseStockfish.classList.remove('active');
                        phaseStockfish.classList.add('done');
                        phaseStockfish.querySelector('.phase-icon').innerHTML = '<span class="phase-check">&#10003;</span>';
                        phaseStockfish.querySelector('.phase-desc').textContent =
                            `${t('review.precision')}: ${status.accuracy_pct}%`;
                    }

                    // Update gameData
                    gameData.game.accuracy_pct = status.accuracy_pct;
                    gameData.game.blunder_count = status.blunders;
                    gameData.game.mistake_count = status.mistakes;
                    gameData.game.inaccuracy_count = status.inaccuracies;
                    gameData.game.brilliant_count = status.brilliants || 0;
                    gameData.game.great_count = status.greats || 0;

                    // Update header
                    headerEl.innerHTML = buildReviewHeaderHtml(gameData.game);

                    // Re-fetch moves with evals
                    const gameResp = await apiFetch(`/api/games/${gameId}`);
                    if (gameResp.ok) {
                        const freshData = await gameResp.json();
                        gameData.moves = freshData.moves;
                        buildMoveList();
                        buildEvalChart();
                        goToMove(currentMoveIndex);
                    }

                    // Activate coach phase
                    const phaseCoach = document.getElementById('phase-coach');
                    if (phaseCoach) {
                        if (status.coaching_in_progress) {
                            phaseCoach.classList.remove('pending');
                            phaseCoach.classList.add('active');
                            phaseCoach.querySelector('.phase-icon').innerHTML = '<div class="spinner-small"></div>';
                            phaseCoach.querySelector('.phase-desc').textContent = t('review.analysisInProgress');
                        } else if (status.coaching_done) {
                            phaseCoach.classList.remove('pending');
                            phaseCoach.classList.add('done');
                            phaseCoach.querySelector('.phase-icon').innerHTML = '<span class="phase-check">&#10003;</span>';
                            phaseCoach.querySelector('.phase-desc').textContent = t('review.analysisComplete');
                        }
                    }
                }

                if (status.coaching_done && stockfishDone) {
                    // All done — fetch final data with AI summary
                    const finalResp = await apiFetch(`/api/games/${gameId}`);
                    if (finalResp.ok) {
                        const finalData = await finalResp.json();
                        gameData.game.ai_summary = finalData.game.ai_summary;
                        gameData.moves = finalData.moves;
                        renderSummary(finalData.game.ai_summary);
                        const summaryEl = document.getElementById('review-summary');
                        if (summaryEl) summaryEl.classList.add('fade-in');
                        goToMove(currentMoveIndex);
                    }
                    const phaseCoach = document.getElementById('phase-coach');
                    if (phaseCoach) {
                        phaseCoach.classList.remove('active');
                        phaseCoach.classList.add('done');
                        phaseCoach.querySelector('.phase-icon').innerHTML = '<span class="phase-check">&#10003;</span>';
                        phaseCoach.querySelector('.phase-desc').textContent = t('review.analysisComplete');
                    }
                    // Remove progress card
                    setTimeout(() => {
                        const progress = document.getElementById('analysis-progress');
                        if (progress) progress.remove();
                    }, 2000);
                    return;
                }
            } catch (e) {
                if (e.message && e.message !== 'Analysis failed') throw e;
            }
        }
        // Timeout
        const progress = document.getElementById('analysis-progress');
        if (progress) {
            progress.innerHTML = `<div class="analysis-error">${t('review.analysisTimeout')}</div>`;
        }

    } catch (e) {
        const progress = document.getElementById('analysis-progress');
        if (progress) {
            progress.innerHTML = `<div class="analysis-error">${t('review.analysisError', { message: e.message })}</div>`;
        }
        // Re-show analyse button in header
        const headerEl2 = document.getElementById('review-header');
        if (headerEl2) {
            headerEl2.innerHTML = buildReviewHeaderHtml(gameData.game);
            const retryBtn = document.getElementById('btn-analyse');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => runAnalysis(gameId, retryBtn));
            }
        }
    }
}

async function pollCoachingStatus(gameId) {
    const maxPolls = 60; // 3 minutes max
    for (let i = 0; i < maxPolls; i++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
            const resp = await apiFetch(`/api/games/${gameId}/analysis-status`);
            if (!resp.ok) continue;
            const status = await resp.json();

            if (status.coaching_done) {
                // Coaching finished — fetch updated game data
                const phaseCoach = document.getElementById('phase-coach');
                if (phaseCoach) {
                    phaseCoach.classList.remove('active');
                    phaseCoach.classList.add('done');
                    phaseCoach.querySelector('.phase-icon').innerHTML = '<span class="phase-check">&#10003;</span>';
                    phaseCoach.querySelector('.phase-desc').textContent = t('review.analysisComplete');
                }

                // Fetch fresh game data with AI summary
                const gameResp = await apiFetch(`/api/games/${gameId}`);
                if (gameResp.ok) {
                    const freshData = await gameResp.json();
                    gameData.game.ai_summary = freshData.game.ai_summary;
                    gameData.moves = freshData.moves;
                    // Update AI summary with fade-in
                    renderSummary(freshData.game.ai_summary);
                    const summaryEl = document.getElementById('review-summary');
                    if (summaryEl) {
                        summaryEl.classList.add('fade-in');
                    }
                    // Rebuild move list for updated AI comments
                    goToMove(currentMoveIndex);
                }
                return;
            }
        } catch (e) {
            // Polling error, continue
        }
    }
    // Timeout
    const phaseCoach = document.getElementById('phase-coach');
    if (phaseCoach) {
        phaseCoach.classList.remove('active');
        phaseCoach.classList.add('skipped');
        phaseCoach.querySelector('.phase-desc').textContent = t('review.analysisTimeout');
    }
}

function buildReviewHeaderHtml(game) {
    const isWin = (game.result === '1-0' && game.our_color === 'w') || (game.result === '0-1' && game.our_color === 'b');
    const isDraw = game.result === '1/2-1/2';
    const resultClass = isWin ? 'good' : isDraw ? 'inaccuracy' : 'blunder';
    const resultLabel = isWin ? t('review.victory') : isDraw ? t('review.draw') : t('review.defeat');

    const errorsHtml = `
        <div class="rh-errors">
            ${game.brilliant_count ? `<span class="badge badge-brilliant">${game.brilliant_count} ${t('review.brilliant')}</span>` : ''}
            ${game.great_count ? `<span class="badge badge-great">${game.great_count} ${t('review.great')}</span>` : ''}
            ${game.blunder_count ? `<span class="badge badge-blunder">${game.blunder_count} ${game.blunder_count > 1 ? t('review.gaffes') : t('review.gaffe')}</span>` : ''}
            ${game.mistake_count ? `<span class="badge badge-mistake">${game.mistake_count} ${game.mistake_count > 1 ? t('review.erreurs') : t('review.erreur')}</span>` : ''}
            ${game.inaccuracy_count ? `<span class="badge badge-inaccuracy">${game.inaccuracy_count} ${game.inaccuracy_count > 1 ? t('review.imprecisions') : t('review.imprecision')}</span>` : ''}
            ${!game.blunder_count && !game.mistake_count && !game.inaccuracy_count && game.accuracy_pct != null ? `<span class="badge badge-good">${t('review.noErrors')}</span>` : ''}
        </div>
    `;

    const analyseBtn = game.accuracy_pct == null
        ? `<button class="btn btn-analyse" id="btn-analyse" style="margin:0;width:auto;padding:6px 16px;">${t('review.analyseManual')}</button>`
        : '';

    return `
        <span class="rh-opponent">${escapeHtml(game.opponent) || '?'}</span>
        <span class="badge badge-${resultClass} rh-result">${resultLabel}</span>
        ${game.accuracy_pct != null ? `<span class="rh-accuracy">${t('review.precision')}: ${game.accuracy_pct}%</span>` : ''}
        ${errorsHtml}
        <span class="rh-opening">${escapeHtml(game.opening_name) || ''}${game.opening_eco ? ' (' + escapeHtml(game.opening_eco) + ')' : ''}</span>
        ${analyseBtn}
        <span class="rh-layout-actions">
            <button class="btn btn-xs btn-ghost btn-square zone-customize-btn review-customize-btn" aria-label="${t('layout.customizeLayout')}" title="${t('layout.customizeLayout') || 'Personnaliser'}">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="1.5" fill="currentColor"/><circle cx="11" cy="8" r="1.5" fill="currentColor"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/></svg>
            </button>
            <button class="btn btn-xs btn-ghost btn-square review-save-btn" aria-label="${t('layout.saveLayout') || 'Enregistrer les positions'}" title="${t('layout.saveLayout') || 'Enregistrer les positions'}">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2c0-.6.4-1 1-1h8l4 4v8c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V2z"/><path d="M4 15v-5c0-.6.4-1 1-1h6c.6 0 1 .4 1 1v5"/><path d="M6 1v3h4V1"/></svg>
            </button>
            <button class="btn btn-xs btn-ghost btn-square review-reset-btn" aria-label="${t('layout.resetLayout')}" title="${t('layout.resetLayout') || 'Réinitialiser'}">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8a6 6 0 0 1 10.5-4"/><path d="M14 8a6 6 0 0 1-10.5 4"/><polyline points="12 2 12.5 5 9.5 4.5"/><polyline points="4 14 3.5 11 6.5 11.5"/></svg>
            </button>
        </span>
    `;
}

function buildGameInfoHtml(game) {
    return buildReviewHeaderHtml(game);
}
