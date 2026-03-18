/**
 * Training page — interactive puzzles from your own games.
 * Features: interactive Chessground board, score/streak tracking,
 * progressive hints, daily exercises, replay key moments.
 */

import { Chessground } from '/static/vendor/chessground.min.js';
import { Chess } from '/static/vendor/chess.min.js';
import { t } from './i18n.js';
import { apiFetch } from './api.js';
import { showUpgradeModal } from './upgrade-modal.js';

let ground = null;
let chess = null;
let exercises = [];
let currentExercise = null;
let activeTab = 'exercises'; // 'exercises' | 'daily' | 'replay'

/* Session score & streak (persisted in localStorage) */
let score = parseInt(localStorage.getItem('training-score') || '0', 10);
let streak = parseInt(localStorage.getItem('training-streak') || '0', 10);
let bestStreak = parseInt(localStorage.getItem('training-best-streak') || '0', 10);

/* Progressive hint state */
let hintLevel = 0;

/* ─── Category helpers ─── */
function catBarClass(cat) {
    if (cat === 'tactic') return 'cat-tactic';
    if (cat === 'endgame') return 'cat-endgame';
    return 'cat-opening';
}

function catLabel(cat) {
    if (cat === 'tactic') return t('training.tactic');
    if (cat === 'endgame') return t('training.endgame');
    return t('training.openingCat');
}

function starsHtml(difficulty) {
    const d = Math.max(1, Math.min(5, difficulty || 1));
    return '\u2605'.repeat(d) + '\u2606'.repeat(5 - d);
}

function persistScore() {
    localStorage.setItem('training-score', String(score));
    localStorage.setItem('training-streak', String(streak));
    localStorage.setItem('training-best-streak', String(bestStreak));
}

/* ─── Render ─── */
export async function render(container) {
    // Check feature access
    try {
        const check = await fetch('/api/training/exercises?limit=1');
        if (check.status === 402) { showUpgradeModal('training'); return; }
    } catch (e) {}

    container.innerHTML = `
        <div class="training-layout">
            <!-- ====== Sidebar ====== -->
            <div class="training-sidebar card bg-base-200">
                <div class="card-body p-3">
                    <!-- Score & Streak -->
                    <div class="training-score-bar mb-3">
                        <div class="flex gap-3 items-center justify-center">
                            <div class="training-score-item">
                                <span class="text-xs opacity-60">${t('training.score')}</span>
                                <span class="font-bold text-lg" id="score-value">${score}</span>
                            </div>
                            <div class="training-score-item">
                                <span class="text-xs opacity-60">${t('training.streak')}</span>
                                <span class="font-bold text-lg text-warning" id="streak-value">${streak}</span>
                            </div>
                            <div class="training-score-item">
                                <span class="text-xs opacity-60">${t('training.bestStreak')}</span>
                                <span class="font-bold text-lg text-success" id="best-streak-value">${bestStreak}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="stats stats-horizontal shadow w-full mb-3" id="training-stats">
                        <div class="stat py-2 px-3">
                            <div class="stat-title text-xs">${t('training.exercises')}</div>
                            <div class="stat-value text-lg" id="stat-total">-</div>
                        </div>
                        <div class="stat py-2 px-3">
                            <div class="stat-title text-xs">${t('training.solved', { n: '' }).trim()}</div>
                            <div class="stat-value text-lg text-success" id="stat-solved">-</div>
                        </div>
                        <div class="stat py-2 px-3">
                            <div class="stat-title text-xs">${t('training.successRate', { n: '' }).trim()}</div>
                            <div class="stat-value text-lg" id="stat-rate">-</div>
                        </div>
                    </div>

                    <!-- Tabs: Exercises / Daily / Replay -->
                    <div class="tabs tabs-boxed mb-3" id="training-tabs">
                        <a class="tab tab-sm tab-active" data-tab="exercises">${t('training.tabExercises')}</a>
                        <a class="tab tab-sm" data-tab="daily">${t('training.tabDaily')}</a>
                        <a class="tab tab-sm" data-tab="replay">${t('training.tabReplay')}</a>
                    </div>

                    <!-- Filters (only for exercises tab) -->
                    <div class="training-filters flex flex-col gap-2 mb-3" id="training-filters-section">
                        <div class="training-filters-row flex gap-2">
                            <select id="training-category" class="select select-bordered select-sm flex-1" aria-label="${t('training.filterCategory')}">
                                <option value="">${t('training.allCategories')}</option>
                                <option value="tactic">${t('training.tactic')}</option>
                                <option value="endgame">${t('training.endgame')}</option>
                                <option value="opening">${t('training.openingCat')}</option>
                            </select>
                            <select id="training-difficulty" class="select select-bordered select-sm flex-1" aria-label="${t('training.filterDifficulty')}">
                                <option value="">${t('training.allDifficulties')}</option>
                                <option value="1">${t('training.difficulty1')}</option>
                                <option value="2">${t('training.difficulty2')}</option>
                                <option value="3">${t('training.difficulty3')}</option>
                                <option value="4">${t('training.difficulty4')}</option>
                                <option value="5">${t('training.difficulty5')}</option>
                            </select>
                        </div>
                        <label class="label cursor-pointer justify-start gap-2">
                            <input type="checkbox" id="training-unsolved" class="checkbox checkbox-sm">
                            <span class="label-text text-sm">${t('training.unsolved')}</span>
                        </label>
                    </div>

                    <div class="exercise-list" id="exercise-list">
                        <div class="spinner"></div>
                    </div>
                </div>
            </div>

            <!-- ====== Main ====== -->
            <div class="training-main">
                <div id="training-turn-bar" aria-live="polite"></div>

                <div class="training-board-wrap">
                    <div class="cg-wrap" id="training-board" aria-label="${t('training.puzzleBoard')}" role="img"></div>
                </div>

                <!-- Board flash overlay -->
                <div id="training-board-flash" class="training-board-flash hidden"></div>

                <div class="training-controls" id="training-controls">
                    <p class="opacity-60">${t('training.selectExercise')}</p>
                </div>

                <div id="training-feedback" aria-live="assertive" role="alert"></div>

                <div id="training-info" class="training-exercise-info"></div>
            </div>
        </div>
    `;

    // Init board
    ground = Chessground(document.getElementById('training-board'), {
        orientation: 'white',
        viewOnly: false,
        coordinates: true,
        ranksPosition: 'left',
        movable: {
            free: false,
            color: undefined,
            dests: new Map(),
        },
        events: {
            move: onPlayerMove,
        },
    });

    // Load data
    await Promise.all([loadExercises(), loadStats()]);

    // Recalculate board bounds after async data loaded, then snap wrap to container size
    requestAnimationFrame(() => {
        if (ground) ground.redrawAll();
        snapBoardSize();
    });

    // Filters
    document.getElementById('training-category').addEventListener('change', loadExercises);
    document.getElementById('training-difficulty').addEventListener('change', loadExercises);
    document.getElementById('training-unsolved').addEventListener('change', loadExercises);

    // Tab switching
    document.querySelectorAll('#training-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
}

export function destroy() {
    if (ground) { ground.destroy(); ground = null; }
    chess = null;
    exercises = [];
    currentExercise = null;
    hintLevel = 0;
}

/* ─── Tab Switching ─── */
function switchTab(tab) {
    activeTab = tab;

    // Update tab UI
    document.querySelectorAll('#training-tabs .tab').forEach(el => {
        el.classList.toggle('tab-active', el.dataset.tab === tab);
    });

    // Show/hide filters (only for exercises tab)
    const filtersSection = document.getElementById('training-filters-section');
    if (filtersSection) {
        filtersSection.style.display = tab === 'exercises' ? '' : 'none';
    }

    if (tab === 'exercises') {
        loadExercises();
    } else if (tab === 'daily') {
        loadDailyExercises();
    } else if (tab === 'replay') {
        loadReplayMoment();
    }
}

/* ─── Data Loading ─── */
async function loadExercises() {
    const category = document.getElementById('training-category')?.value || '';
    const difficulty = document.getElementById('training-difficulty')?.value || '';
    const unsolved = document.getElementById('training-unsolved')?.checked || false;

    let url = '/api/training/exercises?limit=50';
    if (category) url += `&category=${category}`;
    if (unsolved) url += '&unsolved_only=true';

    try {
        const resp = await fetch(url);
        let data = await resp.json();
        // Client-side difficulty filter
        if (difficulty) {
            const d = parseInt(difficulty);
            data = data.filter(ex => ex.difficulty === d);
        }
        exercises = data;
    } catch (e) {
        exercises = [];
    }

    renderExerciseList();
}

async function loadDailyExercises() {
    const listEl = document.getElementById('exercise-list');
    if (listEl) listEl.innerHTML = '<div class="spinner"></div>';

    try {
        const resp = await fetch('/api/training/daily');
        const data = await resp.json();

        if (data.exercises && data.exercises.length > 0) {
            exercises = data.exercises;
            renderExerciseList();

            // Show weakness indicator
            if (data.weak_category) {
                const catName = catLabel(data.weak_category);
                const weakBadge = document.createElement('div');
                weakBadge.className = 'alert alert-warning text-sm py-2 mb-2';
                weakBadge.textContent = t('training.weakCategory', { category: catName });
                listEl?.insertBefore(weakBadge, listEl.firstChild);
            }
        } else {
            if (listEl) {
                listEl.innerHTML = `<p class="opacity-60 text-sm p-4">${t('training.dailyEmpty')}</p>`;
            }
        }
    } catch (e) {
        if (listEl) {
            listEl.innerHTML = `<p class="opacity-60 text-sm p-4">${t('training.dailyEmpty')}</p>`;
        }
    }
}

async function loadReplayMoment() {
    const listEl = document.getElementById('exercise-list');
    if (listEl) listEl.innerHTML = '<div class="spinner"></div>';

    try {
        const resp = await fetch('/api/training/replay-moment');
        if (!resp.ok) {
            if (listEl) listEl.innerHTML = `<p class="opacity-60 text-sm p-4">${t('training.replayEmpty')}</p>`;
            return;
        }
        const moment = await resp.json();
        renderReplayMoment(moment);
    } catch (e) {
        if (listEl) {
            listEl.innerHTML = `<p class="opacity-60 text-sm p-4">${t('training.replayEmpty')}</p>`;
        }
    }
}

async function loadStats() {
    try {
        const resp = await fetch('/api/training/stats');
        const stats = await resp.json();
        const elTotal = document.getElementById('stat-total');
        const elSolved = document.getElementById('stat-solved');
        const elRate = document.getElementById('stat-rate');
        if (elTotal) elTotal.textContent = stats.total ?? 0;
        if (elSolved) elSolved.textContent = stats.solved ?? 0;
        if (elRate) elRate.textContent = (stats.success_rate ?? 0) + '%';
    } catch (e) {}
}

/* ─── Exercise List ─── */
function renderExerciseList() {
    const listEl = document.getElementById('exercise-list');
    if (!listEl) return;

    if (!exercises.length) {
        listEl.innerHTML = `<p class="opacity-60 text-sm p-4">${t('training.noExercises')}</p>`;
        return;
    }

    listEl.innerHTML = exercises.map((ex, i) => {
        const statusClass = ex.solved ? 'status-correct' : ex.attempted ? 'status-incorrect' : 'status-unattempted';
        const statusIcon = ex.solved ? '\u2713' : ex.attempted ? '\u2717' : '\u2014';
        return `
        <div class="exercise-item ${ex.solved ? 'solved' : ''}" data-idx="${i}">
            <div class="exercise-cat-bar ${catBarClass(ex.category)}"></div>
            <div class="exercise-body">
                <div class="exercise-body-top">
                    <span class="exercise-num">#${ex.id}</span>
                    <span class="exercise-stars">${starsHtml(ex.difficulty)}</span>
                </div>
                <div class="exercise-cat-label">${catLabel(ex.category)}</div>
            </div>
            <div class="exercise-status-icon ${statusClass}">${statusIcon}</div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.exercise-item').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.idx);
            if (!isNaN(idx) && exercises[idx]) {
                selectExercise(exercises[idx]);
            }
        });
    });
}

/* ─── Replay Moment Render ─── */
function renderReplayMoment(moment) {
    const listEl = document.getElementById('exercise-list');
    if (!listEl) return;

    listEl.innerHTML = `
        <div class="p-3">
            <h3 class="font-bold text-sm mb-2">${t('training.replayTitle')}</h3>
            <p class="text-sm opacity-70 mb-3">${t('training.replayDesc')}</p>
            <div class="card bg-base-300 p-3 mb-3">
                <div class="text-sm">${t('training.replayFrom', { opponent: escapeHtml(moment.opponent) || '?', move: moment.move_number || '?' })}</div>
                <div class="text-sm text-error mt-1">${t('training.replayPlayed', { move: escapeHtml(moment.played_move_san) })}</div>
                <span class="pill pill-xs mt-2 ${moment.classification === 'blunder' ? 'pill-error' : 'pill-warning'}">${escapeHtml(moment.classification)}</span>
            </div>
            <div class="flex gap-2">
                <button class="btn btn-sm btn-primary flex-1" id="btn-replay-try">${t('training.replayMoment')}</button>
                <button class="btn btn-sm btn-ghost" id="btn-replay-another">${t('training.replayAnother')}</button>
            </div>
            ${moment.game_id ? `<a href="#review/${moment.game_id}" class="btn btn-sm btn-ghost w-full mt-2">${t('training.replayReview')}</a>` : ''}
        </div>
    `;

    // Set up the board with the replay moment
    document.getElementById('btn-replay-try')?.addEventListener('click', () => {
        selectReplayMoment(moment);
    });
    document.getElementById('btn-replay-another')?.addEventListener('click', loadReplayMoment);
}

function selectReplayMoment(moment) {
    // Convert replay moment to exercise-like structure for board interaction
    const fakeExercise = {
        id: null,
        fen: moment.fen,
        solution_uci: moment.solution_uci,
        solution_san: moment.solution_san,
        category: 'tactic',
        difficulty: moment.classification === 'blunder' ? 2 : 3,
        source_game_id: moment.game_id,
        source_move_number: moment.move_number,
        solved: false,
        attempted: false,
        _isReplay: true,
        _playedMove: moment.played_move_san,
    };
    selectExercise(fakeExercise);
}

/* ─── Select Exercise ─── */
function selectExercise(exercise) {
    currentExercise = exercise;
    hintLevel = 0;

    chess = new Chess();
    const loaded = chess.load(exercise.fen);
    if (!loaded) {
        console.warn('Training: invalid FEN, falling back to constructor', exercise.fen);
        chess = new Chess(exercise.fen);
    }
    const turn = chess.turn() === 'w' ? 'white' : 'black';

    // Legal moves
    const dests = getLegalDests(chess);
    const inCheck = chess.in_check();

    // First reset movable to force Chessground to re-evaluate
    ground.set({
        fen: exercise.fen,
        orientation: turn,
        turnColor: turn,
        lastMove: undefined,
        check: inCheck,
        movable: {
            free: false,
            color: turn,
            dests: dests,
        },
        draggable: {
            enabled: true,
        },
    });
    ground.setAutoShapes([]);

    // Turn indicator bar
    const turnBar = document.getElementById('training-turn-bar');
    if (turnBar) {
        const dotClass = turn === 'white' ? 'dot-white' : 'dot-black';
        const barClass = turn === 'white' ? 'turn-white' : 'turn-black';
        const label = turn === 'white' ? t('training.whiteToPlay') : t('training.blackToPlay');
        turnBar.innerHTML = `
            <div class="training-turn-bar ${barClass}">
                <span class="turn-dot ${dotClass}"></span>
                ${label}
            </div>`;
    }

    // Controls: Progressive Hints + Skip
    const controls = document.getElementById('training-controls');
    controls.innerHTML = `
        <div class="flex gap-2 items-center" role="toolbar" aria-label="${t('training.puzzleControls')}">
            <div class="dropdown dropdown-top">
                <label tabindex="0" class="btn btn-ghost btn-sm" aria-haspopup="true">${t('training.hint')} \u25BE</label>
                <ul tabindex="0" class="dropdown-content menu p-1 shadow bg-base-300 rounded-box w-48 z-10" role="menu">
                    <li role="none"><a id="btn-hint-1" role="menuitem">${t('training.hintLevel1')}</a></li>
                    <li role="none"><a id="btn-hint-2" role="menuitem">${t('training.hintLevel2')}</a></li>
                    <li role="none"><a id="btn-hint-3" role="menuitem">${t('training.hintLevel3')}</a></li>
                </ul>
            </div>
            <button class="btn btn-ghost btn-sm" id="btn-skip" aria-label="${t('training.skip')}">${t('training.skip')}</button>
        </div>
    `;

    document.getElementById('btn-hint-1')?.addEventListener('click', () => getProgressiveHint(1));
    document.getElementById('btn-hint-2')?.addEventListener('click', () => getProgressiveHint(2));
    document.getElementById('btn-hint-3')?.addEventListener('click', () => getProgressiveHint(3));
    document.getElementById('btn-skip')?.addEventListener('click', skipExercise);

    // Clear feedback & hints
    const feedback = document.getElementById('training-feedback');
    if (feedback) feedback.innerHTML = '';

    // Info card
    const info = document.getElementById('training-info');
    if (info) {
        const parts = [];
        if (exercise._isReplay) {
            parts.push(`<span class="pill pill-info pill-xs">${t('training.replayTitle')}</span>`);
            parts.push(t('training.replayPlayed', { move: exercise._playedMove }));
        } else if (exercise.source_game_id) {
            parts.push(`${t('training.fromGame')} <a href="#review/${exercise.source_game_id}">n\u00B0${exercise.source_game_id}</a>, ${t('training.move')} ${exercise.source_move_number || '?'}`);
        }
        parts.push(`${starsHtml(exercise.difficulty)}`);
        info.innerHTML = parts.join(' &middot; ');
    }

    // Highlight in list
    document.querySelectorAll('.exercise-item').forEach(el => el.classList.remove('active'));
    const idx = exercises.indexOf(exercise);
    const item = document.querySelector(`.exercise-item[data-idx="${idx}"]`);
    if (item) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // Force Chessground to recalculate bounds, then snap wrap size
    requestAnimationFrame(() => {
        if (ground) ground.redrawAll();
        snapBoardSize();
    });
}

/* ─── Snap wrap to container (eliminate rounding gap) ─── */
function snapBoardSize() {
    const wrap = document.getElementById('training-board');
    const container = wrap?.querySelector('cg-container');
    if (!wrap || !container) return;
    const size = container.getBoundingClientRect().width;
    if (size > 0) {
        wrap.style.width = size + 'px';
        wrap.style.height = size + 'px';
    }
}

/* ─── Legal Dests Helper ─── */
function getLegalDests(chessInstance) {
    const dests = new Map();
    const moves = chessInstance.moves({ verbose: true });
    for (const m of moves) {
        if (!dests.has(m.from)) dests.set(m.from, []);
        dests.get(m.from).push(m.to);
    }
    return dests;
}

/* ─── Board Flash Animation ─── */
function flashBoard(correct) {
    const boardWrap = document.querySelector('.training-board-wrap');
    if (!boardWrap) return;

    const flashClass = correct ? 'training-flash-correct' : 'training-flash-incorrect';
    boardWrap.classList.add(flashClass);
    setTimeout(() => {
        boardWrap.classList.remove(flashClass);
    }, 600);
}

/* ─── Player Move ─── */
async function onPlayerMove(from, to) {
    if (!currentExercise) return;

    // Handle promotion: check if the move is a pawn reaching last rank
    let moveUci = from + to;
    if (chess) {
        const piece = chess.get(from);
        if (piece && piece.type === 'p') {
            const rank = to[1];
            if ((piece.color === 'w' && rank === '8') || (piece.color === 'b' && rank === '1')) {
                moveUci += 'q'; // Default promotion to queen
            }
        }
    }

    // For replay moments, check locally
    if (currentExercise._isReplay) {
        const correct = moveUci === currentExercise.solution_uci;
        handleResult(correct, currentExercise.solution_san, from, to);
        return;
    }

    try {
        const resp = await apiFetch(`/api/training/exercises/${currentExercise.id}/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ move_uci: moveUci }),
        });
        const result = await resp.json();
        handleResult(result.correct, result.solution_san, from, to, result.explanation);
    } catch (e) {
        console.error('Check answer error:', e);
    }
}

function handleResult(correct, solutionSan, from, to, explanation) {
    const feedback = document.getElementById('training-feedback');
    const controls = document.getElementById('training-controls');

    // Flash board
    flashBoard(correct);

    // Update score & streak
    if (correct) {
        score++;
        streak++;
        if (streak > bestStreak) bestStreak = streak;
    } else {
        streak = 0;
    }
    persistScore();
    updateScoreDisplay();

    if (correct) {
        // Green feedback card
        feedback.innerHTML = `
            <div class="training-feedback feedback-correct">
                <div class="feedback-icon text-2xl">\u2713</div>
                <div class="feedback-body flex-1">
                    <div class="font-semibold">${t('training.correct')} <strong>${solutionSan}</strong></div>
                    ${explanation ? `<div class="text-sm opacity-80 mt-1">${explanation}</div>` : ''}
                    <div class="mt-2">
                        <button class="btn btn-sm btn-primary" id="btn-next-exercise">${t('training.nextExercise')} \u2192</button>
                    </div>
                </div>
            </div>`;

        ground.setAutoShapes([{ orig: from, dest: to, brush: 'green' }]);
        controls.innerHTML = '';
        if (currentExercise) currentExercise.solved = true;

        document.getElementById('btn-next-exercise')?.addEventListener('click', nextExercise);
    } else {
        // Red feedback card
        feedback.innerHTML = `
            <div class="training-feedback feedback-incorrect">
                <div class="feedback-icon text-2xl">\u2717</div>
                <div class="feedback-body flex-1">
                    <div class="font-semibold">${t('training.incorrect')} <strong>${solutionSan}</strong></div>
                    ${explanation ? `<div class="text-sm opacity-80 mt-1">${explanation}</div>` : ''}
                    <div class="mt-2 flex gap-2">
                        <button class="btn btn-sm btn-ghost" id="btn-retry">${t('training.retry')}</button>
                        <button class="btn btn-sm btn-primary" id="btn-next-exercise">${t('training.next')} \u2192</button>
                    </div>
                </div>
            </div>`;

        // Show correct move arrow
        if (currentExercise && currentExercise.solution_uci) {
            ground.setAutoShapes([{
                orig: currentExercise.solution_uci.slice(0, 2),
                dest: currentExercise.solution_uci.slice(2, 4),
                brush: 'green',
            }]);
        }

        controls.innerHTML = '';

        document.getElementById('btn-retry')?.addEventListener('click', () => selectExercise(currentExercise));
        document.getElementById('btn-next-exercise')?.addEventListener('click', nextExercise);
    }

    // Reload stats only for non-replay exercises
    if (!currentExercise?._isReplay) {
        loadStats();
        renderExerciseList();
    }

    // Recalculate bounds after feedback card changes layout
    requestAnimationFrame(() => { if (ground) ground.redrawAll(); });
}

function updateScoreDisplay() {
    const scoreEl = document.getElementById('score-value');
    const streakEl = document.getElementById('streak-value');
    const bestEl = document.getElementById('best-streak-value');
    if (scoreEl) scoreEl.textContent = score;
    if (streakEl) streakEl.textContent = streak;
    if (bestEl) bestEl.textContent = bestStreak;
}

/* ─── Navigation ─── */
function nextExercise() {
    if (activeTab === 'replay') {
        loadReplayMoment();
        return;
    }

    const idx = exercises.indexOf(currentExercise);
    const next = exercises[idx + 1] || exercises[0];
    if (next) selectExercise(next);
}

function skipExercise() {
    // Skip without marking as failed — just go to next
    nextExercise();
}

/* ─── Progressive Hints ─── */
async function getProgressiveHint(level) {
    if (!currentExercise) return;
    hintLevel = level;

    const feedbackArea = document.getElementById('training-feedback');

    // For replay moments, generate hint locally from solution
    if (currentExercise._isReplay) {
        const localHint = generateLocalHint(currentExercise, level);
        displayHint(localHint, level);
        return;
    }

    // Show loading
    const existingHints = document.querySelectorAll('.hint-text');
    // Keep existing hints, add loading indicator
    const loadingEl = document.createElement('div');
    loadingEl.className = 'alert alert-info shadow-sm text-sm mt-2 hint-loading';
    loadingEl.textContent = t('training.hintLoading');
    feedbackArea?.appendChild(loadingEl);

    try {
        const resp = await apiFetch(`/api/training/exercises/${currentExercise.id}/hint?level=${level}`, {
            method: 'POST',
        });
        const data = await resp.json();

        // Remove loading
        loadingEl.remove();

        if (data.hint) {
            displayHint(data.hint, level);
        }
    } catch (e) {
        loadingEl.remove();
    }
}

function displayHint(hintText, level) {
    const feedbackArea = document.getElementById('training-feedback');
    if (!feedbackArea) return;

    // Remove previous hints of same or lower level
    feedbackArea.querySelectorAll('.hint-text').forEach(el => {
        const existingLevel = parseInt(el.dataset.level || '0');
        if (existingLevel <= level) el.remove();
    });

    const levelLabel = t('training.hintProgressiveLabel', { level: String(level) });
    const hintEl = document.createElement('div');
    hintEl.className = `alert alert-info shadow-sm text-sm mt-2 hint-text`;
    hintEl.dataset.level = String(level);
    hintEl.innerHTML = `<strong>${levelLabel}</strong> ${hintText}`;
    feedbackArea.appendChild(hintEl);
}

function generateLocalHint(exercise, level) {
    // Simple local hint generation for replay moments
    const uci = exercise.solution_uci;
    if (!uci || uci.length < 4) return t('training.defaultHint');

    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);

    if (level === 1) {
        // General area hint
        const file = to.charCodeAt(0) - 'a'.charCodeAt(0);
        if (file <= 3) return 'Regardez l\'aile dame.';
        return 'Regardez l\'aile roi.';
    } else if (level === 2) {
        return `La pi\u00e8ce cl\u00e9 est en ${from}.`;
    } else {
        return `D\u00e9placez vers la case ${to}.`;
    }
}

/** Escape HTML entities to prevent XSS in innerHTML templates. */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
