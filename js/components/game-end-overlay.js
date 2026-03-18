/**
 * Game-end overlay — visual indicators on king squares.
 *
 * - Resignation / timeout: red flag badge on the loser's king
 * - Checkmate: red badge on loser + fallen king visual + green badge on winner
 * - Stalemate / draw: no overlay
 */

const OVERLAY_CLS = 'game-end-overlay';

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Show game-end overlays on a Chessground board.
 * @param {HTMLElement} boardEl     – the .cg-wrap element (or its parent)
 * @param {string}      fen        – current FEN position
 * @param {string}      result     – '1-0', '0-1', '1/2-1/2'
 * @param {string}      cause      – 'checkmate','resignation','resign','timeout', etc.
 * @param {string}      orientation – 'white' or 'black'
 */
export function showGameEndOverlay(boardEl, fen, result, cause, orientation) {
    clearGameEndOverlay(boardEl);
    if (!boardEl || !fen || !result || result === '*') return;

    const normalCause = (cause || '').toLowerCase();

    let winnerColor, loserColor;
    if (result === '1-0')      { winnerColor = 'white'; loserColor = 'black'; }
    else if (result === '0-1') { winnerColor = 'black'; loserColor = 'white'; }
    else return;

    const winnerKingSq = findKingSquare(fen, winnerColor);
    const loserKingSq  = findKingSquare(fen, loserColor);

    const wrap = getCgWrap(boardEl);
    if (!wrap) return;

    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLS;

    if (normalCause === 'checkmate' || normalCause === 'mate') {
        if (loserKingSq) {
            // Hide the real king piece and place a fallen king overlay on its square
            hideKingPiece(wrap, loserColor);
            overlay.appendChild(createFallenKing(loserKingSq, loserColor, orientation));
            overlay.appendChild(createBadge(loserKingSq, 'loss', orientation));
        }
        if (winnerKingSq) {
            overlay.appendChild(createBadge(winnerKingSq, 'win', orientation));
        }
    } else if (['resignation', 'resign', 'timeout', 'outoftime'].includes(normalCause)) {
        if (loserKingSq) {
            overlay.appendChild(createBadge(loserKingSq, 'flag', orientation));
        }
    } else {
        if (loserKingSq) {
            overlay.appendChild(createBadge(loserKingSq, 'flag', orientation));
        }
    }

    wrap.appendChild(overlay);
}

/**
 * Remove all game-end overlays and restore hidden kings.
 */
export function clearGameEndOverlay(boardEl) {
    if (!boardEl) return;
    const wrap = getCgWrap(boardEl);
    if (!wrap) return;
    wrap.querySelectorAll('.' + OVERLAY_CLS).forEach(el => el.remove());
    // Restore any hidden king pieces
    wrap.querySelectorAll('piece.king-hidden').forEach(el => {
        el.classList.remove('king-hidden');
    });
}

/* ------------------------------------------------------------------ */
/*  Internals                                                         */
/* ------------------------------------------------------------------ */

function getCgWrap(el) {
    if (el.classList.contains('cg-wrap')) return el;
    return el.querySelector('.cg-wrap') || el.closest('.cg-wrap') || el;
}

function findKingSquare(fen, color) {
    const kingChar = color === 'white' ? 'K' : 'k';
    const ranks = fen.split(' ')[0].split('/');
    for (let r = 0; r < 8; r++) {
        let f = 0;
        for (const ch of ranks[r]) {
            if (ch >= '1' && ch <= '8') { f += parseInt(ch); continue; }
            if (ch === kingChar) {
                return String.fromCharCode(97 + f) + String(8 - r);
            }
            f++;
        }
    }
    return null;
}

function squareToPercent(square, orientation) {
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1]) - 1;
    const isWhite = orientation === 'white' || orientation === 'w';
    return {
        x: (isWhite ? file : 7 - file) * 12.5,
        y: (isWhite ? 7 - rank : rank) * 12.5,
    };
}

function createBadge(square, type, orientation) {
    const pos = squareToPercent(square, orientation);
    const badge = document.createElement('div');
    badge.className = `king-badge king-badge-${type}`;
    badge.style.left = `calc(${pos.x + 12.5}% - 2px)`;
    badge.style.top  = `calc(${pos.y}% - 2px)`;
    badge.innerHTML = BADGE_SVG[type] || '';
    return badge;
}

/**
 * Create a fallen (tilted) king overlay element positioned on the square.
 * This replaces the hidden real piece visually.
 */
function createFallenKing(square, color, orientation) {
    const pos = squareToPercent(square, orientation);
    const el = document.createElement('div');
    el.className = 'fallen-king';
    el.style.left = `${pos.x}%`;
    el.style.top  = `${pos.y}%`;
    el.style.width = '12.5%';
    el.style.height = '12.5%';
    el.innerHTML = KING_SVG[color] || '';
    return el;
}

/**
 * Hide the real Chessground king piece (so the overlay replaces it).
 */
function hideKingPiece(wrap, color) {
    const cls = color === 'white' ? 'white' : 'black';
    wrap.querySelectorAll(`piece.king.${cls}`).forEach(p => {
        p.classList.add('king-hidden');
    });
}

/* ------------------------------------------------------------------ */
/*  SVG assets                                                        */
/* ------------------------------------------------------------------ */

const BADGE_SVG = {
    flag: `<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17" fill="#dc2626" stroke="#fff" stroke-width="1.5"/>
      <g transform="translate(9,5)" fill="#fff">
        <rect x="1" y="2" width="2.5" height="22" rx="1.25"/>
        <path d="M5 3 L19 6.5 L19 15 L5 11.5 Z" opacity="0.95"/>
      </g>
    </svg>`,

    loss: `<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17" fill="#dc2626" stroke="#fff" stroke-width="1.5"/>
      <g transform="translate(18,18) rotate(-40) translate(-9,-11)" fill="#fff">
        <path d="M1 17 L1.5 12 L0 5 L4.5 9 L9 3 L13.5 9 L18 5 L16.5 12 L17 17 Z"/>
        <rect x="1.5" y="17.5" width="15" height="2.5" rx="1.25"/>
      </g>
    </svg>`,

    win: `<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="17" fill="#16a34a" stroke="#fff" stroke-width="1.5"/>
      <g transform="translate(9,7)" fill="#fff">
        <path d="M1 17 L1.5 12 L0 5 L4.5 9 L9 3 L13.5 9 L18 5 L16.5 12 L17 17 Z"/>
        <rect x="1.5" y="17.5" width="15" height="2.5" rx="1.25"/>
      </g>
    </svg>`,
};

/**
 * Full-square SVG of a king piece (cburnett style) — upright, no rotation.
 * The rotation is animated via CSS transform on the .fallen-king container.
 */
const KING_SVG = {
    white: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
      <g fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22.5 11.63V6M20 8h5" stroke-linejoin="miter"/>
        <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"
              fill="#fff" stroke-linecap="butt" stroke-linejoin="miter"/>
        <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z"
              fill="#fff"/>
        <path d="M11.5 30c5.5-3 15.5-3 21 0M11.5 33.5c5.5-3 15.5-3 21 0M11.5 37c5.5-3 15.5-3 21 0"/>
      </g>
    </svg>`,

    black: `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
      <g fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22.5 11.63V6" stroke-linejoin="miter"/>
        <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"
              fill="#000" stroke-linecap="butt" stroke-linejoin="miter"/>
        <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z"
              fill="#000"/>
        <path d="M20 8h5" stroke-linejoin="miter"/>
        <path d="M32 29.5s8.5-4 6.03-9.65C34.15 14 25 18 22.5 24.5l.01 2.1-.01-2.1C20 18 9.906 14 6.997 19.85c-2.497 5.65 4.853 9 4.853 9"
              stroke="#fff"/>
        <path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0"
              stroke="#fff"/>
      </g>
    </svg>`,
};
