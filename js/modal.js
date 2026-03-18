/**
 * Modal & toast infrastructure — reusable overlay + notifications.
 */

import { t } from './i18n.js';

let _overlay = null;

/**
 * Show a centered modal dialog.
 * @param {Object} opts
 * @param {string} opts.title - Modal title
 * @param {string} opts.body - HTML body content
 * @param {Array<{label:string, cls?:string, onClick?:Function}>} opts.actions - Action buttons
 * @param {string} [opts.cls] - Extra CSS class on .modal-dialog
 */
export function showModal({ title, body, actions = [], cls = '' }) {
    closeModal();

    _overlay = document.createElement('div');
    _overlay.className = 'modal-overlay';
    _overlay.innerHTML = `
        <div class="modal-dialog ${cls}">
            <div class="modal-title">${title}</div>
            <div class="modal-body">${body}</div>
            <div class="modal-actions" id="modal-actions"></div>
        </div>
    `;

    // Close on overlay click (outside dialog)
    _overlay.addEventListener('click', (e) => {
        if (e.target === _overlay) closeModal();
    });

    // Close on ESC
    _overlay._escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', _overlay._escHandler);

    document.body.appendChild(_overlay);

    // Add action buttons
    const actionsEl = _overlay.querySelector('#modal-actions');
    for (const action of actions) {
        const btn = document.createElement('button');
        btn.className = action.cls || 'btn';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            if (action.onClick) action.onClick();
            else closeModal();
        });
        actionsEl.appendChild(btn);
    }

    // Animate in
    requestAnimationFrame(() => _overlay.classList.add('visible'));
}

/**
 * Close the current modal.
 */
export function closeModal() {
    if (!_overlay) return;
    if (_overlay._escHandler) {
        document.removeEventListener('keydown', _overlay._escHandler);
    }
    _overlay.classList.remove('visible');
    const el = _overlay;
    setTimeout(() => el.remove(), 200);
    _overlay = null;
}

/* ─── Toasts ─── */

const MAX_TOASTS = 3;

function _getContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.className = 'toast-container';
        document.body.appendChild(c);
    }
    return c;
}

/**
 * Show a toast notification.
 * @param {string} message - Text content
 * @param {'info'|'success'|'warning'|'error'} [type='info']
 * @param {number} [duration=4000] - Auto-dismiss ms
 */
export function showToast(message, type = 'info', duration = 4000) {
    const container = _getContainer();

    // Cap visible toasts
    while (container.children.length >= MAX_TOASTS) {
        container.firstChild.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));

    const dismiss = () => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    };

    toast.addEventListener('click', dismiss);

    if (duration > 0) {
        setTimeout(dismiss, duration);
    }
}
