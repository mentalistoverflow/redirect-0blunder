/**
 * Game-over modal component — DaisyUI 5 modal with result, cause, stats,
 * action buttons (review / new game / rematch), and deferred AI summary.
 */

import { t } from '../i18n.js';

let _modalEl = null;
let _currentData = null;

// ─── Helpers ─────────────────────────────────────────────────────

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

/**
 * Determine outcome: 'win' | 'loss' | 'draw' based on result string + our color.
 */
function getOutcome(result, ourColor) {
    if (!result) return 'draw';
    if (result.includes('1/2-1/2')) return 'draw';
    if (result.includes('1-0') && ourColor === 'w') return 'win';
    if (result.includes('0-1') && ourColor === 'b') return 'win';
    if (result.includes('1-0') && ourColor === 'b') return 'loss';
    if (result.includes('0-1') && ourColor === 'w') return 'loss';
    return 'draw';
}

/**
 * Return the translated result title and associated CSS color class.
 */
function getResultDisplay(outcome) {
    switch (outcome) {
        case 'win':
            return { text: t('live.victory'), cls: 'text-success', color: '#f5c542' };
        case 'loss':
            return { text: t('live.defeat'), cls: 'text-error', color: '' };
        case 'draw':
        default:
            return { text: t('live.draw'), cls: 'text-base-content/60', color: '' };
    }
}

/**
 * Return translated cause of game end.
 */
function getCauseText(cause) {
    if (!cause) return '';
    const causeMap = {
        checkmate: 'live.checkmate',
        timeout: 'live.timeout',
        resignation: 'live.resignation',
        resign: 'live.resignation',
        draw: 'live.draw',
        abort: 'live.abort',
        stalemate: 'live.draw',
    };
    const key = causeMap[cause.toLowerCase()];
    return key ? t(key) : escapeHtml(cause);
}

/**
 * Format markdown-like AI summary text to simple HTML.
 */
function formatSummary(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/^### (.+)$/gm, '<h5 class="font-semibold mt-2">$1</h5>');
    html = html.replace(/^## (.+)$/gm, '<h4 class="font-bold mt-3">$1</h4>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul class="list-disc pl-4 my-1">$1</ul>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<br>\s*(<h[45])/g, '$1');
    html = html.replace(/(<\/h[45]>)\s*<br>/g, '$1');
    html = html.replace(/<br>\s*(<ul)/g, '$1');
    html = html.replace(/(<\/ul>)\s*<br>/g, '$1');
    return html;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Show the game-over modal.
 * @param {Object} opts
 * @param {string} opts.result - PGN result string ('1-0', '0-1', '1/2-1/2', '*')
 * @param {string} [opts.cause] - End cause (checkmate, timeout, resignation, draw, abort)
 * @param {Object} [opts.stats] - { good, mistakes, blunders }
 * @param {string} [opts.gameId] - Lichess game ID (for rematch)
 * @param {number|string} [opts.dbGameId] - Database game ID (for review link)
 * @param {string} [opts.opponent] - Opponent username (for rematch)
 * @param {string} [opts.ourColor] - 'w' or 'b'
 * @param {Function} [opts.onNewGame] - Callback for "Nouvelle partie"
 * @param {Function} [opts.onRematch] - Callback for "Revanche"
 */
export function showGameModal({ result, cause, stats, gameId, dbGameId, opponent, ourColor = 'w', onNewGame, onRematch } = {}) {
    hideGameModal();

    _currentData = { result, cause, stats, gameId, dbGameId, opponent, ourColor, onNewGame, onRematch };
    const outcome = getOutcome(result, ourColor);
    const display = getResultDisplay(outcome);
    const causeText = getCauseText(cause);

    const good = stats?.good ?? 0;
    const mistakes = stats?.mistakes ?? 0;
    const blunders = stats?.blunders ?? 0;

    // Build modal DOM
    _modalEl = document.createElement('div');
    _modalEl.className = 'modal modal-open';
    _modalEl.setAttribute('role', 'dialog');

    // Result icon
    let resultIcon = '';
    if (outcome === 'win') {
        resultIcon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/><circle cx="12" cy="12" r="10"/></svg>';
    } else if (outcome === 'loss') {
        resultIcon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/><circle cx="12" cy="12" r="10"/></svg>';
    } else {
        resultIcon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
    }

    // Color classes for result heading
    let resultColorStyle = '';
    if (outcome === 'win') {
        resultColorStyle = 'color: #f5c542;'; // gold
    } else if (outcome === 'loss') {
        resultColorStyle = 'color: var(--fallback-er, oklch(var(--er)));'; // DaisyUI error color
    } else {
        resultColorStyle = 'color: var(--fallback-bc, oklch(var(--bc) / 0.6));'; // muted
    }

    _modalEl.innerHTML = `
        <div class="modal-box max-w-md">
            <!-- Result heading -->
            <div class="text-center mb-4">
                <div style="${resultColorStyle}" class="mb-2 flex justify-center">${resultIcon}</div>
                <h3 class="text-2xl font-bold" style="${resultColorStyle}">${escapeHtml(display.text)}</h3>
                ${causeText ? `<p class="text-sm opacity-60 mt-1">${causeText}</p>` : ''}
            </div>

            <!-- Quick stats -->
            <div class="stats stats-horizontal shadow w-full mb-4">
                <div class="stat place-items-center py-2 px-3">
                    <div class="stat-title text-xs">${t('live.goodMoves')}</div>
                    <div class="stat-value text-lg text-success">${good}</div>
                </div>
                <div class="stat place-items-center py-2 px-3">
                    <div class="stat-title text-xs">${t('live.mistakes')}</div>
                    <div class="stat-value text-lg text-warning">${mistakes}</div>
                </div>
                <div class="stat place-items-center py-2 px-3">
                    <div class="stat-title text-xs">${t('live.blunders')}</div>
                    <div class="stat-value text-lg text-error">${blunders}</div>
                </div>
            </div>

            <!-- AI summary placeholder -->
            <div id="game-modal-summary"></div>

            <!-- Action buttons -->
            <div class="modal-action justify-center gap-2">
                ${dbGameId ? `<a href="#review/${dbGameId}" class="btn btn-outline btn-sm" id="game-modal-review">${t('live.reviewGame')}</a>` : ''}
                <button class="btn btn-primary btn-sm" id="game-modal-new">${t('live.newGame')}</button>
                <button class="btn btn-secondary btn-sm" id="game-modal-rematch">${t('live.rematch')}</button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop">
            <button type="button" id="game-modal-backdrop">close</button>
        </form>
    `;

    document.body.appendChild(_modalEl);

    // Bind events
    _modalEl.querySelector('#game-modal-review')?.addEventListener('click', () => {
        hideGameModal();
    });

    _modalEl.querySelector('#game-modal-new')?.addEventListener('click', () => {
        hideGameModal();
        if (onNewGame) onNewGame();
    });

    _modalEl.querySelector('#game-modal-rematch')?.addEventListener('click', () => {
        hideGameModal();
        if (onRematch) onRematch();
    });

    _modalEl.querySelector('#game-modal-backdrop')?.addEventListener('click', () => {
        hideGameModal();
    });

    // Close on ESC
    _modalEl._escHandler = (e) => {
        if (e.key === 'Escape') hideGameModal();
    };
    document.addEventListener('keydown', _modalEl._escHandler);
}

/**
 * Append AI summary to the currently open modal.
 * @param {string} aiSummary - Markdown-formatted AI analysis text
 */
export function updateGameSummary(aiSummary) {
    if (!_modalEl || !aiSummary) return;

    const container = _modalEl.querySelector('#game-modal-summary');
    if (!container) return;

    container.innerHTML = `
        <div class="divider text-xs opacity-60">${t('live.postGameAnalysis')}</div>
        <div class="text-sm opacity-80 mb-4 max-h-48 overflow-y-auto">${formatSummary(aiSummary)}</div>
    `;

    // If review button was missing (no dbGameId at modal creation), add it now
    if (_currentData && !_currentData.dbGameId) return;
    const actions = _modalEl.querySelector('.modal-action');
    if (actions && !actions.querySelector('#game-modal-review') && _currentData?.dbGameId) {
        const reviewLink = document.createElement('a');
        reviewLink.href = `#review/${_currentData.dbGameId}`;
        reviewLink.className = 'btn btn-outline btn-sm';
        reviewLink.id = 'game-modal-review';
        reviewLink.textContent = t('live.reviewGame');
        reviewLink.addEventListener('click', () => hideGameModal());
        actions.insertBefore(reviewLink, actions.firstChild);
    }
}

/**
 * Close and remove the game-over modal.
 */
export function hideGameModal() {
    if (!_modalEl) return;

    if (_modalEl._escHandler) {
        document.removeEventListener('keydown', _modalEl._escHandler);
    }

    _modalEl.classList.remove('modal-open');
    const el = _modalEl;
    // Allow DaisyUI close animation before removing
    setTimeout(() => el.remove(), 200);

    _modalEl = null;
    _currentData = null;
}
