/**
 * zone-drag.js — Positionnement des zones par glisser-déposer avec grille magnétique.
 *
 * Desktop (>900px) : drag souris via barre supérieure → le module suit le curseur
 *   et s'aimante sur une grille invisible de GRID_SIZE pixels.
 *   → Limites : les modules ne peuvent pas sortir de la zone visible du conteneur.
 *   → Positions + dimensions persistées en BDD via API.
 *   → Scroll molette autorisé pendant le drag.
 * Mobile/tablette (≤900px) : pas de drag (handles masqués par CSS).
 * Reset : supprime toutes les positions personnalisées, retour au flux par défaut.
 */

import { t } from './i18n.js';
import { apiFetch } from './api.js';
import { showModal, closeModal } from './modal.js';

const MOBILE_BREAKPOINT = 900;
const GRID_SIZE = 4; // taille de la grille invisible en pixels
const _AUTO_WIDTH = new Set(['controls']); // zones dont la largeur reste auto (pas de width forcé)
const _RESIZABLE = new Set(['chart', 'moves', 'summary', 'coach']); // zones redimensionnables
let _instances = [];

/** Aimante une valeur sur la grille */
function _snap(v) {
    return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

/**
 * Initialise le drag pour une page.
 * @param {Object} opts
 * @param {string} opts.page — identifiant page pour la persistance
 * @param {HTMLElement} opts.container — conteneur parent des zones
 * @param {string[]} opts.defaultOrder — ordre par défaut des zone IDs
 * @param {Object|null} [opts.savedPositions=null] — positions sauvegardées {zoneId: {x, y, w, h}}
 * @param {string[]|null} [opts.savedOrder=null] — ordre mobile sauvegardé
 */
export function initZoneDrag({ page, container, defaultOrder, savedPositions, savedOrder }) {
    const instance = {
        page,
        container,
        defaultOrder: [...defaultOrder],
        positions: savedPositions ? { ...savedPositions } : null,
        _savedPositions: savedPositions ? JSON.parse(JSON.stringify(savedPositions)) : null,
        mobileOrder: savedOrder ? [...savedOrder] : null,
        _absoluteMode: false,
        _handles: [],
        _listeners: [],
        _modal: null,
        _saveTimeout: null,
    };

    if (window.innerWidth > MOBILE_BREAKPOINT) {
        // Desktop : appliquer les positions sauvegardées si elles existent
        if (instance.positions && Object.keys(instance.positions).length > 0) {
            _enterAbsoluteMode(instance);
        }
    } else {
        // Mobile : appliquer l'ordre sauvegardé via CSS order
        if (instance.mobileOrder) {
            _applyMobileOrder(instance, instance.mobileOrder);
        }
    }

    _injectHandles(instance);
    _setupMouseDrag(instance);
    _setupResizeObserver(instance);

    _instances.push(instance);
    return instance;
}

export function destroyZoneDrag(instance) {
    if (!instance) return;
    if (instance._saveTimeout) clearTimeout(instance._saveTimeout);
    if (instance._resizeObserver) instance._resizeObserver.disconnect();
    instance._handles.forEach(h => h.remove());
    instance._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
    if (instance._modal) instance._modal.remove();
    _instances = _instances.filter(i => i !== instance);
}

/* ── Helpers ── */
function _getZoneEl(inst, zoneId) {
    return inst.container.querySelector(`[data-zone-id="${zoneId}"]`);
}

function _on(inst, el, evt, fn, opts) {
    el.addEventListener(evt, fn, opts);
    inst._listeners.push([el, evt, fn, opts]);
}

/** Trouve le premier ancêtre scrollable ou document.documentElement */
function _getScrollParent(el) {
    let parent = el.parentElement;
    while (parent) {
        const overflow = getComputedStyle(parent).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return parent;
        parent = parent.parentElement;
    }
    return document.documentElement;
}

/**
 * Passe en mode absolu : fige tous les modules à leur position actuelle.
 * Si inst.positions contient des données sauvegardées, les applique.
 * Sinon, capture les positions actuelles du flux CSS.
 */
function _enterAbsoluteMode(inst) {
    if (inst._absoluteMode) return;

    if (inst.positions && Object.keys(inst.positions).length > 0) {
        // Appliquer les positions sauvegardées
        // D'abord passer en display: block pour annuler le grid
        inst.container.classList.add('zone-container-absolute');
        let maxBottom = 0;
        for (const zoneId of inst.defaultOrder) {
            const el = _getZoneEl(inst, zoneId);
            if (!el) continue;
            const pos = inst.positions[zoneId];
            if (!pos) continue;
            el.style.position = 'absolute';
            el.style.left = pos.x + 'px';
            el.style.top = pos.y + 'px';
            if (pos.w && !_AUTO_WIDTH.has(zoneId)) el.style.width = pos.w + 'px';
            if (pos.h && _RESIZABLE.has(zoneId)) el.style.height = pos.h + 'px';
            const bottom = pos.y + (pos.h || el.offsetHeight);
            if (bottom > maxBottom) maxBottom = bottom;
        }
        inst.container.style.minHeight = maxBottom + 'px';
    } else {
        // Capturer les positions actuelles du flux → absolute sans mouvement visible
        _captureAndFreeze(inst);
    }

    inst._absoluteMode = true;
}

/**
 * Capture les positions actuelles de tous les modules dans le flux,
 * puis les passe en position absolute aux mêmes coordonnées.
 * Résultat : visuellement rien ne bouge.
 */
function _captureAndFreeze(inst) {
    const containerRect = inst.container.getBoundingClientRect();

    // Étape 1 : capturer toutes les positions AVANT de changer le display
    // Les positions sont relatives au coin haut-gauche du conteneur.
    // getBoundingClientRect() retourne les positions viewport, donc
    // on soustrait la position du conteneur. Pas besoin de scrollTop car
    // les éléments absolute utilisent la même référence que le conteneur.
    const captured = {};
    for (const zoneId of inst.defaultOrder) {
        const el = _getZoneEl(inst, zoneId);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        captured[zoneId] = {
            x: _snap(Math.round(rect.left - containerRect.left)),
            y: _snap(Math.round(rect.top - containerRect.top)),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
        };
    }

    // Étape 2 : passer le conteneur en display: block pour annuler le grid
    inst.container.classList.add('zone-container-absolute');

    // Étape 3 : appliquer en position absolute
    let maxBottom = 0;
    for (const zoneId of inst.defaultOrder) {
        const el = _getZoneEl(inst, zoneId);
        if (!el) continue;
        const pos = captured[zoneId];
        if (!pos) continue;
        el.style.position = 'absolute';
        el.style.left = pos.x + 'px';
        el.style.top = pos.y + 'px';
        if (!_AUTO_WIDTH.has(zoneId)) el.style.width = pos.w + 'px';
        const bottom = pos.y + pos.h;
        if (bottom > maxBottom) maxBottom = bottom;
    }

    inst.positions = captured;
    inst.container.style.minHeight = maxBottom + 'px';
}

/* ── Appliquer l'ordre mobile ── */
function _applyMobileOrder(inst, order) {
    order.forEach((id, i) => {
        const el = _getZoneEl(inst, id);
        if (el) el.style.order = String(i);
    });
}

/* ── Injection des handles de drag ── */
function _injectHandles(inst) {
    for (const zoneId of inst.defaultOrder) {
        const el = _getZoneEl(inst, zoneId);
        if (!el) continue;
        el.classList.add('zone-draggable');
        // Vérifier si un handle existe déjà
        if (el.querySelector('.zone-drag-handle')) continue;

        const handle = document.createElement('button');
        handle.className = 'zone-drag-handle';
        handle.setAttribute('aria-label', t('layout.dragHandle'));
        handle.setAttribute('tabindex', '0');
        handle.dataset.zoneTarget = zoneId;

        // 6 dots de grip
        const dots = document.createElement('span');
        dots.className = 'zone-drag-dots';
        dots.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 6; i++) {
            dots.appendChild(document.createElement('span'));
        }
        handle.appendChild(dots);

        el.style.position = el.style.position || 'relative';
        el.insertBefore(handle, el.firstChild);
        inst._handles.push(handle);
    }
}

/* ── Setup du drag souris (desktop uniquement) ── */
function _setupMouseDrag(inst) {
    let dragging = null; // { zoneId, el, offsetX, offsetY }
    let lastClientX = 0;
    let lastClientY = 0;

    function onMouseDown(e) {
        if (window.innerWidth <= MOBILE_BREAKPOINT) return;

        // Trouver le handle cliqué
        const handle = e.target.closest('.zone-drag-handle');
        if (!handle) return;
        const zoneId = handle.dataset.zoneTarget;
        if (!zoneId) return;
        const el = _getZoneEl(inst, zoneId);
        if (!el) return;

        e.preventDefault();
        e.stopPropagation();

        // Premier drag → passer en mode absolu (fige tous les modules)
        if (!inst._absoluteMode) {
            _enterAbsoluteMode(inst);
        }

        const elRect = el.getBoundingClientRect();

        // Offset du curseur par rapport au coin haut-gauche du module
        const offsetX = e.clientX - elRect.left;
        const offsetY = e.clientY - elRect.top;

        el.style.zIndex = '1000';
        el.classList.add('zone-dragging');
        document.body.classList.add('zone-drag-active');

        dragging = { zoneId, el, offsetX, offsetY };
        lastClientX = e.clientX;
        lastClientY = e.clientY;
    }

    function _updateDragPosition(clientX, clientY) {
        if (!dragging) return;

        const containerRect = inst.container.getBoundingClientRect();
        const containerW = inst.container.clientWidth;

        let newX = clientX - containerRect.left - dragging.offsetX;
        let newY = clientY - containerRect.top - dragging.offsetY;

        // Snap sur la grille d'abord
        newX = _snap(newX);
        newY = _snap(newY);

        // Puis clamper dans les limites (après snap pour éviter les dépassements)
        const elW = dragging.el.offsetWidth;
        const maxX = Math.floor((containerW - elW) / GRID_SIZE) * GRID_SIZE;
        if (newX < 0) newX = 0;
        if (newX > maxX) newX = maxX;
        if (newY < 0) newY = 0;

        dragging.el.style.left = newX + 'px';
        dragging.el.style.top = newY + 'px';
    }

    function onMouseMove(e) {
        if (!dragging) return;
        e.preventDefault();
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        _updateDragPosition(e.clientX, e.clientY);
    }

    // Scroll molette pendant le drag → recalculer la position du module
    function onScroll() {
        if (!dragging) return;
        _updateDragPosition(lastClientX, lastClientY);
    }

    function onMouseUp() {
        if (!dragging) return;

        const el = dragging.el;
        el.classList.remove('zone-dragging');
        document.body.classList.remove('zone-drag-active');
        el.style.zIndex = '';

        // Capturer la nouvelle position
        const newPos = {
            x: parseInt(el.style.left, 10) || 0,
            y: parseInt(el.style.top, 10) || 0,
            w: el.offsetWidth,
            h: el.offsetHeight,
        };

        // Mettre à jour les positions sauvegardées
        if (!inst.positions) inst.positions = {};
        inst.positions[dragging.zoneId] = newPos;

        // Recalculer la hauteur min du conteneur
        _updateContainerHeight(inst);

        dragging = null;

        // Recalculer le push-down (pas de sauvegarde auto)
        _pushModulesDown(inst);
    }

    // Écouter les événements
    _on(inst, inst.container, 'mousedown', onMouseDown, false);
    _on(inst, document, 'mousemove', onMouseMove, false);
    _on(inst, document, 'mouseup', onMouseUp, false);
    // Scroll : recalculer la position pendant le drag quand la page scrolle
    const scrollParent = _getScrollParent(inst.container);
    _on(inst, scrollParent, 'scroll', onScroll, { passive: true });
}

/* ── Observer les redimensionnements CSS natifs (resize: both) ── */
function _setupResizeObserver(inst) {
    if (typeof ResizeObserver === 'undefined') return;

    // Map des tailles initiales pour détecter les vrais changements utilisateur
    const sizes = new Map();
    const NO_RESIZE = new Set(['board', 'controls']);

    const observer = new ResizeObserver((entries) => {
        if (!inst._absoluteMode) return;
        let changed = false;

        for (const entry of entries) {
            const el = entry.target;
            const zoneId = el.dataset.zoneId;
            if (!zoneId || NO_RESIZE.has(zoneId)) continue;

            const w = Math.round(entry.contentRect.width);
            const h = Math.round(entry.contentRect.height);
            const prev = sizes.get(zoneId);

            // Ignorer le premier appel (taille initiale) et les changements mineurs
            if (!prev) {
                sizes.set(zoneId, { w, h });
                continue;
            }
            if (Math.abs(w - prev.w) < GRID_SIZE && Math.abs(h - prev.h) < GRID_SIZE) continue;

            sizes.set(zoneId, { w, h });

            // Mettre à jour les positions sauvegardées
            if (inst.positions && inst.positions[zoneId]) {
                inst.positions[zoneId].w = w;
                inst.positions[zoneId].h = h;
                changed = true;
            }
        }

        if (changed) {
            _pushModulesDown(inst);
        }
    });

    for (const zoneId of inst.defaultOrder) {
        if (NO_RESIZE.has(zoneId)) continue;
        const el = _getZoneEl(inst, zoneId);
        if (el) observer.observe(el);
    }

    inst._resizeObserver = observer;
}

/* ── Recalculer la hauteur minimale du conteneur ── */
function _updateContainerHeight(inst) {
    if (!inst.positions) return;
    let maxBottom = 0;
    for (const zoneId of inst.defaultOrder) {
        const pos = inst.positions[zoneId];
        if (!pos) continue;
        const el = _getZoneEl(inst, zoneId);
        const h = pos.h || (el ? el.offsetHeight : 0);
        const bottom = pos.y + h;
        if (bottom > maxBottom) maxBottom = bottom;
    }
    inst.container.style.minHeight = maxBottom + 'px';
}

/* ── Push-down : décale les modules qui chevauchent un module agrandi ── */
const _PUSH_GAP = 4; // espace minimum entre modules pour éviter le chevauchement

function _pushModulesDown(inst) {
    if (!inst._absoluteMode || !inst.positions) return;

    // Collecter les zones avec position intentionnelle et hauteur réelle
    const zones = [];
    for (const zoneId of inst.defaultOrder) {
        const el = _getZoneEl(inst, zoneId);
        if (!el) continue;
        const pos = inst.positions[zoneId];
        if (!pos) continue;
        zones.push({
            id: zoneId,
            el,
            x: pos.x,
            baseY: pos.y,
            w: pos.w || el.offsetWidth,
            h: el.offsetHeight,
        });
    }

    // Trier par Y intentionnel (haut en bas)
    zones.sort((a, b) => a.baseY - b.baseY);

    // Calculer la position affichée en partant des positions intentionnelles
    const displayY = new Map();
    for (const z of zones) {
        displayY.set(z.id, z.baseY);
    }

    // Pousser les modules qui chevauchent
    for (let i = 0; i < zones.length; i++) {
        const upper = zones[i];
        const upperY = displayY.get(upper.id);
        const upperBottom = upperY + upper.h;

        for (let j = i + 1; j < zones.length; j++) {
            const lower = zones[j];
            // Vérifier le chevauchement horizontal
            const hOverlap = upper.x < lower.x + lower.w && upper.x + upper.w > lower.x;
            if (!hOverlap) continue;

            const lowerY = displayY.get(lower.id);
            if (lowerY < upperBottom + _PUSH_GAP) {
                displayY.set(lower.id, upperBottom + _PUSH_GAP);
            }
        }
    }

    // Appliquer les positions affichées (seul Y change, X reste intentionnel)
    let maxBottom = 0;
    for (const z of zones) {
        const y = displayY.get(z.id);
        z.el.style.top = y + 'px';
        const bottom = y + z.h;
        if (bottom > maxBottom) maxBottom = bottom;
    }

    inst.container.style.minHeight = maxBottom + 'px';
}

/* ── Sauvegarde manuelle en BDD ── */
async function _savePositions(inst) {
    if (!inst.positions) return;
    try {
        await apiFetch('/api/auth/layout-preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: inst.page,
                positions: inst.positions,
            }),
        });
    } catch (_) {
        // Non-critique : on ne bloque pas l'UX
    }
}

/* ── Modal de réordonnement (mobile) ── */
export function openReorderModal(inst) {
    if (!inst) return;
    // Supprimer une modale existante
    if (inst._modal) inst._modal.remove();

    const order = inst.mobileOrder || [...inst.defaultOrder];

    const modal = document.createElement('dialog');
    modal.className = 'modal';
    modal.id = 'zone-reorder-modal';
    modal.innerHTML = `
        <div class="modal-box max-w-sm">
            <h3 class="font-bold text-lg mb-4">${t('layout.reorder_title') || 'Réorganiser les modules'}</h3>
            <ul class="zone-reorder-list space-y-2" role="list"></ul>
            <div class="modal-action">
                <button class="btn btn-sm" data-action="reset">${t('layout.reset') || 'Réinitialiser'}</button>
                <button class="btn btn-sm btn-ghost" data-action="cancel">${t('common.cancel') || 'Annuler'}</button>
                <button class="btn btn-sm btn-primary" data-action="save">${t('common.save') || 'Enregistrer'}</button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button>fermer</button></form>
    `;

    const list = modal.querySelector('.zone-reorder-list');
    const currentOrder = [...order];

    function renderList() {
        list.innerHTML = '';
        currentOrder.forEach((id, i) => {
            const li = document.createElement('li');
            li.className = 'zone-reorder-item flex items-center gap-2 p-2 rounded-lg bg-base-200';
            li.innerHTML = `
                <span class="flex-1 font-medium">${t('layout.zone.' + id) || id}</span>
                <button class="btn btn-xs btn-ghost" data-dir="up" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
                <button class="btn btn-xs btn-ghost" data-dir="down" data-idx="${i}" ${i === currentOrder.length - 1 ? 'disabled' : ''}>▼</button>
            `;
            list.appendChild(li);
        });
    }

    renderList();

    list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-dir]');
        if (!btn) return;
        const idx = parseInt(btn.dataset.idx, 10);
        const dir = btn.dataset.dir;
        if (dir === 'up' && idx > 0) {
            [currentOrder[idx - 1], currentOrder[idx]] = [currentOrder[idx], currentOrder[idx - 1]];
        } else if (dir === 'down' && idx < currentOrder.length - 1) {
            [currentOrder[idx], currentOrder[idx + 1]] = [currentOrder[idx + 1], currentOrder[idx]];
        }
        renderList();
    });

    modal.addEventListener('click', async (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'cancel') {
            modal.close();
        } else if (action === 'reset') {
            inst.mobileOrder = null;
            inst.defaultOrder.forEach((id) => {
                const el = _getZoneEl(inst, id);
                if (el) el.style.order = '';
            });
            try {
                await apiFetch('/api/auth/layout-preferences', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: inst.page, order: inst.defaultOrder }),
                });
            } catch (_) { /* non-critique */ }
            modal.close();
        } else if (action === 'save') {
            inst.mobileOrder = [...currentOrder];
            _applyMobileOrder(inst, currentOrder);
            try {
                await apiFetch('/api/auth/layout-preferences', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: inst.page, order: currentOrder }),
                });
            } catch (_) { /* non-critique */ }
            modal.close();
        }
    });

    document.body.appendChild(modal);
    inst._modal = modal;
    modal.showModal();
}

/* ── Sauvegarde manuelle (bouton disquette) avec confirmation ── */
export function saveLayout(inst) {
    if (!inst || !inst.positions) return;

    showModal({
        title: t('layout.saveLayout') || 'Enregistrer les positions',
        body: `<p>${t('layout.saveConfirm') || 'Enregistrer les positions actuelles des modules ?'}</p>`,
        actions: [
            {
                label: t('common.cancel') || 'Annuler',
                cls: 'btn btn-ghost',
                onClick: () => closeModal(),
            },
            {
                label: t('layout.saveLayout') || 'Enregistrer',
                cls: 'btn btn-primary',
                onClick: () => {
                    closeModal();
                    _savePositions(inst);
                    inst._savedPositions = JSON.parse(JSON.stringify(inst.positions));
                },
            },
        ],
    });
}

/* ── Notification de changement de contenu (pour recalculer le push-down) ── */
export function notifyContentChange(inst) {
    if (!inst || !inst._absoluteMode) return;
    // Laisser le DOM se recalculer avant de mesurer
    requestAnimationFrame(() => _pushModulesDown(inst));
}

/* ── Reset layout : recharger les positions sauvegardées ── */
export function resetLayout(inst) {
    if (!inst) return;

    if (inst._savedPositions && Object.keys(inst._savedPositions).length > 0) {
        // Recharger les positions sauvegardées en BDD
        inst.positions = JSON.parse(JSON.stringify(inst._savedPositions));

        if (!inst._absoluteMode) {
            _enterAbsoluteMode(inst);
        } else {
            // Réappliquer les positions sauvegardées sur le DOM
            for (const zoneId of inst.defaultOrder) {
                const el = _getZoneEl(inst, zoneId);
                if (!el) continue;
                const pos = inst.positions[zoneId];
                if (!pos) continue;
                el.style.left = pos.x + 'px';
                el.style.top = pos.y + 'px';
                if (pos.w && !_AUTO_WIDTH.has(zoneId)) el.style.width = pos.w + 'px';
                if (pos.h && _RESIZABLE.has(zoneId)) el.style.height = pos.h + 'px';
            }
        }

        // Recalculer le push-down au cas où le contenu a changé
        requestAnimationFrame(() => _pushModulesDown(inst));
    } else {
        // Pas de positions sauvegardées → retour à la grille par défaut
        _doResetToGrid(inst);
    }
}

async function _doResetToGrid(inst) {
    for (const zoneId of inst.defaultOrder) {
        const el = _getZoneEl(inst, zoneId);
        if (!el) continue;
        el.style.position = '';
        el.style.left = '';
        el.style.top = '';
        el.style.width = '';
        el.style.height = '';
        el.style.order = '';
        el.style.zIndex = '';
    }

    inst.container.style.minHeight = '';
    inst.container.classList.remove('zone-container-absolute');
    inst.positions = null;
    inst.mobileOrder = null;
    inst._absoluteMode = false;

    if (inst._resizeObserver) {
        inst._resizeObserver.disconnect();
        inst._resizeObserver = null;
    }

    try {
        await apiFetch('/api/auth/layout-preferences/reset', { method: 'POST' });
    } catch (_) { /* non-critique */ }
}
