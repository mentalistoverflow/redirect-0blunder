/**
 * AI Chat Widget — floating coach panel for chess learning.
 *
 * Provides a persistent floating button that opens a side panel
 * with conversational AI coaching via /api/coach/ask.
 */
import { t } from './i18n.js';
import { apiFetch } from './csrf.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let widgetRoot = null;
let styleEl = null;
let messages = []; // {role: 'user'|'assistant', content: string}
let aiContext = '';
let isOpen = false;
let isSending = false;
let historyLoaded = false;
let activeTab = 'ai'; // 'ai' | 'support'
let ticketScreen = 'form'; // 'form' | 'success'
let ticketEmail = localStorage.getItem('hd_email') || '';
let ticketUserId = localStorage.getItem('hd_uid') || (() => {
    const id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
    localStorage.setItem('hd_uid', id);
    return id;
})();

// Helpdesk API (ticket creation)
const HELPDESK_API = 'https://shaped-enquiry-enlargement-see.trycloudflare.com';
const HELPDESK_APP_KEY = '751c50d6-73bf-4920-8d1e-7f1351ae5eaf';

/** Outside-click handler reference (for cleanup). */
let outsideClickHandler = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create and insert the AI widget into the DOM.
 */
export function initAIWidget() {
    if (widgetRoot) return; // already initialised

    injectStyles();

    widgetRoot = document.createElement('div');
    widgetRoot.id = 'ai-widget';
    widgetRoot.className = 'ai-widget';
    widgetRoot.innerHTML = buildHTML();
    document.body.appendChild(widgetRoot);

    restoreWidgetPosition();
    bindEvents();
    initDrag();
}

/**
 * Remove the widget from the DOM and clean up.
 */
export function destroyAIWidget() {
    if (outsideClickHandler) {
        document.removeEventListener('click', outsideClickHandler, true);
        outsideClickHandler = null;
    }
    if (widgetRoot) {
        widgetRoot.remove();
        widgetRoot = null;
    }
    if (styleEl) {
        styleEl.remove();
        styleEl = null;
    }
    messages = [];
    aiContext = '';
    isOpen = false;
    isSending = false;
    historyLoaded = false;
    activeTab = 'ai';
    ticketScreen = 'form';
}

/**
 * Set additional context to include in API calls (e.g. current FEN, moves).
 * @param {string} context
 */
export function setAIContext(context) {
    aiContext = context || '';
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function buildHTML() {
    return `
        <button class="ai-widget-toggle" aria-label="${t('ai.title')}" aria-expanded="false">
            <svg class="ai-fab-icon ai-fab-icon-chat" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <svg class="ai-fab-icon ai-fab-icon-close hidden" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
        <div class="ai-widget-panel hidden">
            <div class="ai-widget-header">
                <div class="ai-widget-tabs">
                    <button class="ai-tab active" data-tab="ai">
                        <span class="ai-tab-icon">♟️</span>
                        <span class="ai-tab-label">Coach IA</span>
                    </button>
                    <button class="ai-tab" data-tab="support">
                        <span class="ai-tab-icon">🎫</span>
                        <span class="ai-tab-label">Support</span>
                    </button>
                </div>
                <button class="ai-widget-close" aria-label="${t('ai.close')}" title="${t('ai.close')}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>

            <div class="ai-panel-section" id="ai-panel-ai">
                <div class="ai-quick-actions" id="ai-quick-actions">
                    <p class="ai-quick-label">Suggestions rapides</p>
                    <div class="ai-quick-grid">
                        <button class="ai-quick-btn" data-prompt="Analyse ma position actuelle et dis-moi comment améliorer ma stratégie.">♟ Analyse position</button>
                        <button class="ai-quick-btn" data-prompt="Quels sont les meilleurs coups possibles dans cette position ?">💡 Meilleurs coups</button>
                        <button class="ai-quick-btn" data-prompt="Explique l'ouverture qui a été jouée et ses idées principales.">📖 Expliquer l'ouverture</button>
                        <button class="ai-quick-btn" data-prompt="Quelles sont mes erreurs les plus fréquentes et comment les corriger ?">🎯 Mes erreurs</button>
                        <button class="ai-quick-btn" data-prompt="Donne-moi un plan de jeu clair pour les prochains coups.">🗺️ Plan de jeu</button>
                        <button class="ai-quick-btn" data-prompt="Explique-moi les fins de partie essentielles à maîtriser à mon niveau.">⚡ Fins de partie</button>
                    </div>
                </div>
                <div class="ai-widget-messages" aria-live="polite" aria-label="${t('ai.messages')}" role="log"></div>
                <div class="ai-widget-input">
                    <button class="ai-widget-clear ai-input-btn" aria-label="${t('ai.clearHistory')}" title="${t('ai.clearHistory')}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                    <input type="text" class="input input-bordered input-sm"
                           placeholder="${t('ai.placeholder')}" aria-label="${t('ai.inputLabel')}" />
                    <button class="ai-widget-send ai-send-btn" aria-label="${t('ai.send')}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"/>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                        </svg>
                    </button>
                </div>
            </div>

            <div class="ai-panel-section hidden" id="ai-panel-support">
                <div id="ai-support-body"></div>
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function bindEvents() {
    if (!widgetRoot) return;

    const toggleBtn = widgetRoot.querySelector('.ai-widget-toggle');
    const closeBtn = widgetRoot.querySelector('.ai-widget-close');
    const clearBtn = widgetRoot.querySelector('.ai-widget-clear');
    const sendBtn = widgetRoot.querySelector('.ai-widget-send');
    const input = widgetRoot.querySelector('.ai-widget-input input');

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePanel();
    });

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closePanel();
    });

    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearHistory();
    });

    widgetRoot.querySelectorAll('.ai-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            switchTab(tab.dataset.tab);
        });
    });

    widgetRoot.querySelectorAll('.ai-quick-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const prompt = btn.dataset.prompt;
            if (!prompt) return;
            if (input) input.value = prompt;
            // Hide quick actions after using one
            const qa = widgetRoot.querySelector('#ai-quick-actions');
            if (qa) qa.style.display = 'none';
            sendMessage();
        });
    });

    sendBtn.addEventListener('click', () => sendMessage());

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Show quick actions again if messages are cleared
    input.addEventListener('input', () => {
        const qa = widgetRoot.querySelector('#ai-quick-actions');
        if (qa && messages.length === 0 && !input.value.trim()) {
            qa.style.display = '';
        }
    });

    // Close when clicking outside the panel
    outsideClickHandler = (e) => {
        if (!isOpen) return;
        if (widgetRoot && !widgetRoot.contains(e.target)) {
            closePanel();
        }
    };
    document.addEventListener('click', outsideClickHandler, true);
}

function togglePanel() {
    if (isOpen) {
        closePanel();
    } else {
        openPanel();
    }
}

async function openPanel() {
    if (!widgetRoot) return;
    const panel = widgetRoot.querySelector('.ai-widget-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    requestAnimationFrame(() => {
        panel.classList.add('open');
    });
    isOpen = true;
    const toggleBtn = widgetRoot.querySelector('.ai-widget-toggle');
    if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', 'true');
        toggleBtn.querySelector('.ai-fab-icon-chat')?.classList.add('hidden');
        toggleBtn.querySelector('.ai-fab-icon-close')?.classList.remove('hidden');
    }
    const input = widgetRoot.querySelector('.ai-widget-input input');
    if (input) input.focus();

    if (!historyLoaded) {
        historyLoaded = true;
        await loadHistory();
    }
    // Hide quick actions if there are already messages
    if (messages.length > 0) {
        const qa = widgetRoot.querySelector('#ai-quick-actions');
        if (qa) qa.style.display = 'none';
    }
}

function closePanel() {
    if (!widgetRoot) return;
    const panel = widgetRoot.querySelector('.ai-widget-panel');
    if (!panel) return;
    panel.classList.remove('open');
    // After the transition ends, hide completely
    const onEnd = () => {
        if (!panel.classList.contains('open')) {
            panel.classList.add('hidden');
        }
        panel.removeEventListener('transitionend', onEnd);
    };
    panel.addEventListener('transitionend', onEnd);
    isOpen = false;
    const toggleBtn = widgetRoot.querySelector('.ai-widget-toggle');
    if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.querySelector('.ai-fab-icon-chat')?.classList.remove('hidden');
        toggleBtn.querySelector('.ai-fab-icon-close')?.classList.add('hidden');
    }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function loadHistory() {
    try {
        const resp = await fetch('/api/coach/sessions');
        if (!resp.ok) return;
        const data = await resp.json();
        const history = data.messages || [];
        // Show last 20 messages for performance
        const recent = history.slice(-20);
        if (recent.length > 0) {
            messages = recent.map(m => ({ role: m.role, content: m.content }));
            renderMessages();
        }
    } catch (_err) {
        // Silent — history is non-critical
    }
}

async function clearHistory() {
    if (!confirm(t('ai.clearConfirm'))) return;
    try {
        await apiFetch('/api/coach/sessions', { method: 'DELETE' });
    } catch (_err) { /* silent */ }
    messages = [];
    historyLoaded = false;
    renderMessages();
    const qa = widgetRoot.querySelector('#ai-quick-actions');
    if (qa) qa.style.display = '';
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

async function sendMessage() {
    if (isSending) return;
    if (!widgetRoot) return;

    const input = widgetRoot.querySelector('.ai-widget-input input');
    const text = input?.value?.trim();
    if (!text) return;

    input.value = '';

    // Hide quick actions once conversation starts
    const qa = widgetRoot.querySelector('#ai-quick-actions');
    if (qa) qa.style.display = 'none';

    // Record user message
    messages.push({ role: 'user', content: text });
    renderMessages();

    // Show typing indicator
    isSending = true;
    renderMessages();

    try {
        const body = { question: text };
        // Append context if available
        if (aiContext) {
            body.question = `[Context: ${aiContext}]\n\n${text}`;
        }

        const resp = await apiFetch('/api/coach/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (resp.ok) {
            const data = await resp.json();
            messages.push({ role: 'assistant', content: data.response || '' });
        } else {
            messages.push({ role: 'assistant', content: t('ai.error') });
        }
    } catch (_err) {
        messages.push({ role: 'assistant', content: t('ai.error') });
    } finally {
        isSending = false;
        renderMessages();
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderMessages() {
    if (!widgetRoot) return;
    const container = widgetRoot.querySelector('.ai-widget-messages');
    if (!container) return;

    let html = '';

    for (const msg of messages) {
        if (msg.role === 'user') {
            html += `
                <div class="chat chat-end">
                    <div class="chat-bubble chat-bubble-primary">${escapeHtml(msg.content)}</div>
                </div>`;
        } else {
            html += `
                <div class="chat chat-start">
                    <div class="chat-bubble">${formatSimpleMarkdown(msg.content)}</div>
                </div>`;
        }
    }

    // Typing indicator
    if (isSending) {
        html += `
            <div class="chat chat-start">
                <div class="chat-bubble">
                    <span class="loading loading-dots loading-sm"></span>
                    <span class="ai-widget-thinking-text">${t('ai.thinking')}</span>
                </div>
            </div>`;
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

/**
 * Minimal Markdown formatting for assistant responses.
 */
function formatSimpleMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // List items
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>');
    // Newlines
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<br>\s*(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)\s*<br>/g, '$1');
    return html;
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

function switchTab(tab) {
    activeTab = tab;
    widgetRoot.querySelectorAll('.ai-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    widgetRoot.querySelector('#ai-panel-ai').classList.toggle('hidden', tab !== 'ai');
    widgetRoot.querySelector('#ai-panel-support').classList.toggle('hidden', tab !== 'support');
    const clearBtn = widgetRoot.querySelector('.ai-widget-clear');
    if (clearBtn) clearBtn.style.display = tab === 'ai' ? '' : 'none';
    if (tab === 'support') {
        renderSupportForm();
    } else {
        const input = widgetRoot.querySelector('.ai-widget-input input');
        if (input) input.focus();
    }
}

// ---------------------------------------------------------------------------
// Support / Ticket
// ---------------------------------------------------------------------------

function renderSupportForm() {
    const body = widgetRoot.querySelector('#ai-support-body');
    if (!body || ticketScreen === 'success') return;
    body.innerHTML = `
        <div class="ai-support-form">
            <p class="ai-support-desc">💬 Un problème ou une suggestion ? Notre équipe vous répond rapidement.</p>
            <form id="ai-ticket-form">
                <div class="ai-field">
                    <label>Sujet *</label>
                    <input type="text" id="ai-ticket-title"
                           placeholder="Décrivez votre problème en bref" required maxlength="300">
                </div>
                <div class="ai-field">
                    <label>Description *</label>
                    <textarea id="ai-ticket-desc"
                              placeholder="Donnez-nous plus de détails..." required maxlength="5000"></textarea>
                </div>
                <div class="ai-field">
                    <label>Email (optionnel)</label>
                    <input type="email" id="ai-ticket-email"
                           placeholder="vous@exemple.com" value="${escapeHtml(ticketEmail)}">
                </div>
                <div class="ai-field">
                    <label>Catégorie</label>
                    <select id="ai-ticket-cat">
                        <option value="question">❓ Question</option>
                        <option value="bug">🐛 Bug / Problème</option>
                        <option value="feature">✨ Suggestion</option>
                        <option value="other">📌 Autre</option>
                    </select>
                </div>
                <button type="submit" class="ai-support-submit" id="ai-ticket-submit">Envoyer le ticket</button>
            </form>
        </div>`;
    widgetRoot.querySelector('#ai-ticket-form').addEventListener('submit', submitTicket);
}

async function submitTicket(e) {
    e.preventDefault();
    const btn = widgetRoot.querySelector('#ai-ticket-submit');
    btn.disabled = true;
    btn.textContent = 'Envoi...';

    const email = widgetRoot.querySelector('#ai-ticket-email').value.trim();
    if (email) {
        ticketEmail = email;
        localStorage.setItem('hd_email', email);
    }

    try {
        const res = await fetch(`${HELPDESK_API}/api/tickets/widget`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-App-Key': HELPDESK_APP_KEY,
            },
            body: JSON.stringify({
                title: widgetRoot.querySelector('#ai-ticket-title').value.trim(),
                description: widgetRoot.querySelector('#ai-ticket-desc').value.trim(),
                user_identifier: ticketUserId,
                user_email: email,
                category: widgetRoot.querySelector('#ai-ticket-cat').value,
                priority: 'medium',
            }),
        });
        if (!res.ok) throw new Error('Erreur réseau');
        const ticket = await res.json();
        ticketScreen = 'success';
        renderTicketSuccess(ticket.id);
    } catch (_err) {
        btn.disabled = false;
        btn.textContent = 'Envoyer';
        const form = widgetRoot.querySelector('#ai-ticket-form');
        let errEl = form.querySelector('.ai-ticket-error');
        if (!errEl) {
            errEl = document.createElement('p');
            errEl.className = 'ai-ticket-error';
            form.appendChild(errEl);
        }
        errEl.textContent = 'Une erreur est survenue. Réessayez.';
    }
}

function renderTicketSuccess(ticketId) {
    ticketScreen = 'success';
    const body = widgetRoot.querySelector('#ai-support-body');
    if (!body) return;
    body.innerHTML = `
        <div class="ai-support-success">
            <div class="ai-success-icon">✓</div>
            <h4>Ticket envoyé !</h4>
            <p>Nous avons bien reçu votre demande et reviendrons vers vous rapidement.</p>
            <div class="ai-ticket-ref">Ticket #${ticketId}</div>
            <button class="ai-new-ticket-btn" id="ai-new-ticket">+ Nouveau ticket</button>
        </div>`;
    widgetRoot.querySelector('#ai-new-ticket').addEventListener('click', () => {
        ticketScreen = 'form';
        renderSupportForm();
    });
}

// ---------------------------------------------------------------------------
// Drag & Position
// ---------------------------------------------------------------------------

function restoreWidgetPosition() {
    try {
        const saved = localStorage.getItem('ai_widget_pos');
        if (!saved) return;
        const pos = JSON.parse(saved);
        widgetRoot.style.right = 'auto';
        widgetRoot.style.bottom = 'auto';
        widgetRoot.style.left = pos.left + 'px';
        widgetRoot.style.top = pos.top + 'px';
        updatePanelSide();
    } catch (_e) {}
}

function saveWidgetPos() {
    const rect = widgetRoot.getBoundingClientRect();
    localStorage.setItem('ai_widget_pos', JSON.stringify({ left: rect.left, top: rect.top }));
}

function updatePanelSide() {
    const rect = widgetRoot.getBoundingClientRect();
    widgetRoot.classList.toggle('panel-left', rect.left < window.innerWidth / 2);
    widgetRoot.classList.toggle('panel-down', rect.top < window.innerHeight / 2);
}

function initDrag() {
    const btn = widgetRoot.querySelector('.ai-widget-toggle');
    let isDragging = false, hasDragged = false;
    let startX, startY, startLeft, startTop;

    btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        isDragging = true; hasDragged = false;
        startX = e.clientX; startY = e.clientY;
        const rect = widgetRoot.getBoundingClientRect();
        startLeft = rect.left; startTop = rect.top;
        widgetRoot.style.left = startLeft + 'px';
        widgetRoot.style.top = startTop + 'px';
        widgetRoot.style.right = 'auto';
        widgetRoot.style.bottom = 'auto';
        btn.setPointerCapture(e.pointerId);
    });

    btn.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) hasDragged = true;
        if (!hasDragged) return;
        e.preventDefault();
        const W = window.innerWidth - btn.offsetWidth;
        const H = window.innerHeight - btn.offsetHeight;
        widgetRoot.style.left = Math.max(0, Math.min(W, startLeft + dx)) + 'px';
        widgetRoot.style.top = Math.max(0, Math.min(H, startTop + dy)) + 'px';
        updatePanelSide();
    });

    btn.addEventListener('pointerup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        if (hasDragged) {
            saveWidgetPos();
            // Bloquer le click qui suivrait un drag
            const blockClick = (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
            btn.addEventListener('click', blockClick, { capture: true, once: true });
        }
    });
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.textContent = `
/* ═══════════════════════════════════════════════
   AI Widget — Chess-Learn Coach + Support
   Design: popup bubble moderne avec animations
   ═══════════════════════════════════════════════ */

/* ---- Container ---- */
.ai-widget {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
    width: 56px;
    height: 56px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* ---- FAB Button ---- */
.ai-widget-toggle {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--color-primary, #e94560) 0%, color-mix(in oklch, var(--color-primary, #e94560) 75%, var(--color-secondary, #533483)) 100%);
    color: #fff;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px color-mix(in oklch, var(--color-primary, #e94560) 45%, transparent),
                0 2px 8px rgba(0, 0, 0, 0.35);
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.25s ease;
    animation: ai-fab-glow 3.5s ease-in-out infinite;
    position: relative;
    overflow: hidden;
    opacity: 0.72;
}

.ai-widget-toggle::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    opacity: 0;
    transition: opacity 0.2s;
}

.ai-widget-toggle:hover::before { opacity: 1; }
.ai-widget-toggle:hover {
    opacity: 1;
    transform: scale(1.1);
    box-shadow: 0 6px 24px color-mix(in oklch, var(--color-primary, #e94560) 60%, transparent),
                0 2px 10px rgba(0, 0, 0, 0.4);
}

.ai-widget-toggle:active { transform: scale(0.96); }

.ai-fab-icon {
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s;
}
.ai-fab-icon.hidden {
    display: none;
}

@keyframes ai-fab-glow {
    0%, 100% {
        box-shadow: 0 4px 16px color-mix(in oklch, var(--color-primary, #e94560) 45%, transparent),
                    0 2px 8px rgba(0, 0, 0, 0.35);
    }
    50% {
        box-shadow: 0 4px 28px color-mix(in oklch, var(--color-primary, #e94560) 65%, transparent),
                    0 0 0 10px color-mix(in oklch, var(--color-primary, #e94560) 12%, transparent),
                    0 2px 8px rgba(0, 0, 0, 0.35);
    }
}

/* ---- Panel Popup ---- */
.ai-widget-panel {
    position: absolute;
    bottom: calc(100% + 12px);
    right: 0;
    left: auto;
    width: 380px;
    max-width: calc(100vw - 24px);
    height: 580px;
    max-height: calc(100dvh - 110px);
    background: var(--color-base-200, #161625);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 20px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65),
                0 8px 24px rgba(0, 0, 0, 0.3),
                inset 0 1px 0 rgba(255, 255, 255, 0.06);
    opacity: 0;
    visibility: hidden;
    transform: translateY(16px) scale(0.94);
    transform-origin: bottom right;
    transition: opacity 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                transform 0.28s cubic-bezier(0.34, 1.4, 0.64, 1),
                visibility 0.28s;
}

/* Panel ouvre à gauche quand le FAB est dans la moitié gauche */
.panel-left .ai-widget-panel {
    right: auto;
    left: 0;
    transform-origin: bottom left;
}

/* Panel s'ouvre vers le bas quand le FAB est dans la moitié haute */
.panel-down .ai-widget-panel {
    bottom: auto;
    top: calc(100% + 12px);
    transform-origin: top right;
    transform: translateY(-16px) scale(0.94);
}
.panel-down.panel-left .ai-widget-panel {
    transform-origin: top left;
}
.panel-down .ai-widget-panel.open {
    transform: translateY(0) scale(1);
}

.ai-widget-panel.hidden {
    display: none;
}

.ai-widget-panel.open {
    opacity: 1;
    visibility: visible;
    transform: translateY(0) scale(1);
}

/* ---- Header ---- */
.ai-widget-header {
    display: flex;
    align-items: center;
    padding: 14px 12px 0;
    gap: 8px;
    flex-shrink: 0;
}

/* ---- Tabs ---- */
.ai-widget-tabs {
    flex: 1;
    display: flex;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 3px;
    gap: 2px;
}

.ai-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    border: none;
    background: transparent;
    color: inherit;
    border-radius: 9px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    opacity: 0.5;
    transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
}

.ai-tab.active {
    opacity: 1;
    background: var(--color-base-300, #1e1e32);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3),
                inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.ai-tab:hover:not(.active) {
    opacity: 0.75;
    background: rgba(255, 255, 255, 0.04);
}

.ai-tab-icon {
    font-size: 1rem;
    line-height: 1;
}

.ai-tab-label {
    font-size: 0.78rem;
    letter-spacing: 0.01em;
}

/* ---- Close button ---- */
.ai-widget-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
    transition: all 0.2s;
    flex-shrink: 0;
}
.ai-widget-close:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
    transform: rotate(90deg);
}

/* ---- Panel divider ---- */
.ai-widget-header::after {
    content: '';
    position: absolute;
    top: 62px;
    left: 0;
    right: 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
}

/* ---- Panel sections ---- */
.ai-panel-section {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    margin-top: 14px;
    animation: ai-section-in 0.22s ease;
}

.ai-panel-section.hidden { display: none; }

@keyframes ai-section-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
}

/* ---- Quick actions ---- */
.ai-quick-actions {
    padding: 0 14px 12px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    margin-bottom: 4px;
}

.ai-quick-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.4;
    margin-bottom: 8px;
}

.ai-quick-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
}

.ai-quick-btn {
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 500;
    text-align: left;
    line-height: 1.3;
    transition: all 0.18s ease;
    opacity: 0.8;
}

.ai-quick-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.08);
    border-color: color-mix(in oklch, var(--color-primary, #e94560) 50%, transparent);
    transform: translateY(-1px);
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.2);
}

.ai-quick-btn:active { transform: translateY(0); }

/* ---- Messages ---- */
.ai-widget-messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    scroll-behavior: smooth;
}

.ai-widget-messages::-webkit-scrollbar { width: 3px; }
.ai-widget-messages::-webkit-scrollbar-track { background: transparent; }
.ai-widget-messages::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 99px;
}

.ai-widget-messages .chat {
    animation: ai-msg-in 0.2s ease;
}

@keyframes ai-msg-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
}

.ai-widget-messages .chat-bubble {
    max-width: 88%;
    font-size: 0.865rem;
    line-height: 1.5;
    word-break: break-word;
    border-radius: 14px !important;
}

.ai-widget-messages .chat-end .chat-bubble {
    background: linear-gradient(135deg, var(--color-primary, #e94560), color-mix(in oklch, var(--color-primary, #e94560) 80%, var(--color-secondary, #533483)));
    color: white;
}

.ai-widget-messages .chat-bubble ul {
    margin: 5px 0;
    padding-left: 1.3em;
}
.ai-widget-messages .chat-bubble li { margin-bottom: 3px; }

.ai-widget-messages .chat-bubble code {
    background: rgba(255, 255, 255, 0.1);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 0.82em;
    font-family: 'JetBrains Mono', monospace;
}

.ai-widget-thinking-text {
    margin-left: 6px;
    font-size: 0.8rem;
    opacity: 0.6;
}

/* ---- Input bar ---- */
.ai-widget-input {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
}

.ai-widget-input input {
    flex: 1;
    min-width: 0;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 8px 12px;
    font-size: 0.87rem;
    color: inherit;
    outline: none;
    transition: border-color 0.2s, background 0.2s;
}
.ai-widget-input input:focus {
    border-color: color-mix(in oklch, var(--color-primary, #e94560) 60%, transparent);
    background: rgba(255, 255, 255, 0.07);
}
.ai-widget-input input::placeholder { opacity: 0.35; }

.ai-input-btn {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.5;
    transition: all 0.18s;
    flex-shrink: 0;
}
.ai-input-btn:hover { opacity: 0.9; background: rgba(255, 255, 255, 0.08); }

.ai-send-btn {
    width: 36px;
    height: 36px;
    border-radius: 11px;
    border: none;
    background: linear-gradient(135deg, var(--color-primary, #e94560), color-mix(in oklch, var(--color-primary, #e94560) 75%, var(--color-secondary, #533483)));
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.18s ease;
    box-shadow: 0 2px 8px color-mix(in oklch, var(--color-primary, #e94560) 40%, transparent);
}
.ai-send-btn:hover {
    transform: scale(1.08);
    box-shadow: 0 4px 14px color-mix(in oklch, var(--color-primary, #e94560) 55%, transparent);
}
.ai-send-btn:active { transform: scale(0.95); }

/* ---- Header divider line ---- */
.ai-widget-header { position: relative; }

/* ---- Support form ---- */
.ai-support-form {
    padding: 16px 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 13px;
    overflow-y: auto;
    flex: 1;
}

.ai-support-form::-webkit-scrollbar { width: 3px; }
.ai-support-form::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 99px;
}

.ai-support-desc {
    font-size: 0.82rem;
    opacity: 0.55;
    line-height: 1.5;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
    border-left: 3px solid color-mix(in oklch, var(--color-primary, #e94560) 60%, transparent);
}

.ai-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.ai-field label {
    font-size: 0.75rem;
    font-weight: 700;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

.ai-field input,
.ai-field textarea,
.ai-field select {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 0.87rem;
    color: inherit;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s, background 0.2s;
    width: 100%;
    box-sizing: border-box;
}
.ai-field input:focus,
.ai-field textarea:focus,
.ai-field select:focus {
    border-color: color-mix(in oklch, var(--color-primary, #e94560) 60%, transparent);
    background: rgba(255, 255, 255, 0.06);
}
.ai-field textarea { resize: vertical; min-height: 90px; }
.ai-field select { cursor: pointer; }
.ai-field input::placeholder,
.ai-field textarea::placeholder { opacity: 0.35; }

.ai-support-submit {
    width: 100%;
    padding: 11px;
    border-radius: 12px;
    border: none;
    background: linear-gradient(135deg, var(--color-primary, #e94560), color-mix(in oklch, var(--color-primary, #e94560) 75%, var(--color-secondary, #533483)));
    color: white;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.2s ease,
                opacity 0.2s;
    box-shadow: 0 3px 14px color-mix(in oklch, var(--color-primary, #e94560) 40%, transparent);
    margin-top: 4px;
}
.ai-support-submit:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px color-mix(in oklch, var(--color-primary, #e94560) 55%, transparent);
}
.ai-support-submit:active { transform: scale(0.98); }
.ai-support-submit:disabled { opacity: 0.5; transform: none; cursor: not-allowed; }

.ai-ticket-error {
    color: var(--color-error, #f87272);
    font-size: 0.8rem;
    margin-top: 2px;
    animation: ai-msg-in 0.2s ease;
}

/* ---- Support success ---- */
.ai-support-success {
    flex: 1;
    padding: 40px 20px 24px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    animation: ai-section-in 0.3s cubic-bezier(0.34, 1.4, 0.64, 1);
}

.ai-success-icon {
    width: 58px;
    height: 58px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--color-success, #36d399), color-mix(in oklch, var(--color-success, #36d399) 70%, var(--color-accent, #45a29e)));
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.7rem;
    font-weight: bold;
    box-shadow: 0 4px 20px color-mix(in oklch, var(--color-success, #36d399) 40%, transparent);
}

.ai-support-success h4 {
    font-size: 1.1rem;
    font-weight: 800;
    margin: 0;
}

.ai-support-success p {
    font-size: 0.84rem;
    opacity: 0.6;
    max-width: 260px;
    line-height: 1.5;
}

.ai-ticket-ref {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    opacity: 0.55;
    background: rgba(255, 255, 255, 0.06);
    padding: 5px 16px;
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.06);
}

.ai-new-ticket-btn {
    margin-top: 4px;
    padding: 8px 20px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
    font-size: 0.83rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.18s;
    opacity: 0.7;
}
.ai-new-ticket-btn:hover { opacity: 1; background: rgba(255, 255, 255, 0.1); }

/* ---- Curseur drag ---- */
.ai-widget-toggle {
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
}
.ai-widget-toggle:active {
    cursor: grabbing;
}

/* ---- Mobile ---- */
@media (max-width: 479px) {
    .ai-widget {
        bottom: 14px;
        right: 14px;
    }

    .ai-widget-toggle {
        width: 52px;
        height: 52px;
    }

    /* Bottom sheet sur mobile — override position absolute → fixed */
    .ai-widget-panel {
        position: fixed !important;
        bottom: 0 !important;
        top: auto !important;
        right: 0 !important;
        left: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        height: 88dvh;
        max-height: 88dvh;
        border-radius: 20px 20px 0 0;
        transform-origin: bottom center;
        transform: translateY(100%) scale(1);
    }

    .ai-widget-panel.open {
        transform: translateY(0) scale(1) !important;
    }

    .ai-quick-grid {
        grid-template-columns: 1fr 1fr;
    }
}
`;
    document.head.appendChild(styleEl);
}
