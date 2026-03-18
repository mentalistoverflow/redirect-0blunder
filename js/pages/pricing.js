/**
 * Pricing page — DaisyUI 5 tier comparison cards with Stripe checkout.
 * Route: /#pricing
 * Supports monthly/annual toggle, cancel feedback modal, badge contrast fixes.
 */

import { t, getLocale } from '../i18n.js';
import { apiFetch } from '../api.js';
import { isFreeUser, getUser } from '../user-state.js';

let currentSub = null;
let selectedInterval = 'month'; // 'month' or 'year'

export async function render(container) {
    container.innerHTML = `<div class="flex justify-center py-8"><span class="loading loading-spinner loading-lg"></span></div>`;

    try {
        const [statusResp, tiersResp] = await Promise.all([
            fetch('/api/subscription/status'),
            fetch('/api/subscription/tiers'),
        ]);
        currentSub = statusResp.ok ? await statusResp.json() : null;
        const tiers = tiersResp.ok ? await tiersResp.json() : [];

        renderPricingPage(container, tiers);
    } catch (e) {
        console.error('Pricing page error:', e);
        container.innerHTML = `<div class="alert alert-error">${t('common.error')}</div>`;
    }
}

export function destroy() {
    currentSub = null;
    selectedInterval = 'month';
}

function renderPricingPage(container, tiers) {
    const isExpired = currentSub && currentSub.expired;
    const isActive = currentSub && currentSub.status === 'active' && !isExpired;
    const currentTierSlug = isActive ? (currentSub.tier || 'free') : 'free';

    // Séparer les tiers : gratuit + payants
    const freeTiers = tiers.filter(ti => ti.price_cents === 0);
    const paidTiers = tiers.filter(ti => ti.price_cents > 0);

    // Construire un tier gratuit par défaut si absent
    const freeTier = freeTiers.length > 0 ? freeTiers[0] : {
        id: 0, name: t('subscription.freeTier'), slug: 'free',
        price_cents: 0, currency: 'eur', interval: 'month',
        features: { ai_coaching: false, auto_analysis: false, training: false, advanced_stats: false },
        display_order: 0,
    };

    // Vérifier s'il y a des tiers annuels
    const hasYearly = paidTiers.some(ti => ti.interval === 'year');
    const hasMonthly = paidTiers.some(ti => ti.interval === 'month');
    const showToggle = hasYearly && hasMonthly;

    // Filtrer les tiers payants par interval sélectionné
    const filteredPaid = paidTiers.filter(ti => ti.interval === selectedInterval);
    filteredPaid.sort((a, b) => a.price_cents - b.price_cents);

    // Pour le calcul des économies, trouver le tier mensuel correspondant
    // Slugs: "premium-monthly" → base "premium", "premium-yearly" → base "premium"
    const getBaseSlug = (slug) => slug.replace(/-(?:monthly|yearly|annual)$/, '');
    const monthlyMap = {};
    paidTiers.filter(ti => ti.interval === 'month').forEach(ti => {
        monthlyMap[getBaseSlug(ti.slug)] = ti.price_cents;
    });

    const allFeatures = ['ai_coaching', 'auto_analysis', 'training', 'advanced_stats'];

    // Grace period warning for past_due subscriptions
    const isGracePeriod = currentSub && currentSub.grace_period;
    const graceBanner = isGracePeriod ? `
        <div class="alert alert-warning shadow-lg mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.194-.833-2.964 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"/>
            </svg>
            <div>
                <span class="font-semibold">${t('pricing.gracePeriod')}</span>
            </div>
            <button class="btn btn-sm btn-warning" id="btn-grace-portal">${t('pricing.updatePayment')}</button>
        </div>
    ` : '';

    // Subscription info banner
    let subInfoHtml = '';
    if (currentSub && currentSub.status !== 'none') {
        const tierName = currentSub.tier_name || currentSub.tier || '?';

        if (isExpired) {
            // Expired subscription — show renewal prompt
            let dateStr = '';
            if (currentSub.current_period_end) {
                try {
                    const locale = getLocale();
                    const d = new Date(currentSub.current_period_end);
                    dateStr = d.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
                } catch { /* ignore */ }
            }
            subInfoHtml = `
                <div class="card bg-base-200 shadow-sm mb-6 border border-error/30">
                    <div class="card-body py-4">
                        <div class="flex flex-wrap justify-between items-center gap-4">
                            <div>
                                <div class="text-sm opacity-60">${t('subscription.currentPlan') || 'Plan actuel'}</div>
                                <div class="text-xl font-bold">${t('subscription.freeTier') || 'Gratuit'}</div>
                            </div>
                            <div>
                                <div class="text-sm opacity-60">${escapeHtml(tierName)}</div>
                                <a href="#pricing-grid" class="pill pill-error pill-blink cursor-pointer" id="btn-renew-expired"
                                   title="${t('pricing.renewNow') || 'Renouveler'}">
                                    ${t('pricing.expired').replace('{date}', dateStr)}
                                </a>
                            </div>
                            <div>
                                <button class="btn btn-primary btn-sm" id="btn-renew-action">
                                    ${t('pricing.renewNow') || 'Renouveler'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (isActive) {
            // Active subscription
            const statusLabel = t('subscription.active') || 'Actif';
            let periodHtml = '';
            if (currentSub.current_period_end) {
                try {
                    const locale = getLocale();
                    const d = new Date(currentSub.current_period_end);
                    const dateStr = d.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
                    periodHtml = `<div>
                        <div class="text-sm opacity-60">${t('subscription.nextBilling') || 'Prochaine échéance'}</div>
                        <div>${dateStr}</div>
                    </div>`;
                } catch { /* ignore */ }
            }
            subInfoHtml = `
                <div class="card bg-base-200 shadow-sm mb-6">
                    <div class="card-body py-4">
                        <div class="flex flex-wrap justify-between items-center gap-4">
                            <div>
                                <div class="text-sm opacity-60">${t('subscription.currentPlan') || 'Plan actuel'}</div>
                                <div class="text-xl font-bold">${escapeHtml(tierName)}</div>
                            </div>
                            <div>
                                <div class="text-sm opacity-60">${t('subscription.status') || 'Statut'}</div>
                                <span class="pill pill-success">${statusLabel}</span>
                            </div>
                            ${periodHtml}
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // Toggle HTML — animated segmented control with sliding indicator
    const toggleHtml = showToggle ? `
        <div class="billing-toggle mb-8">
            <div class="billing-switch" role="tablist" aria-label="${t('pricing.billingCycle') || 'Cycle de facturation'}">
                <div class="billing-slider ${selectedInterval === 'year' ? 'right' : ''}"></div>
                <button type="button" role="tab" class="billing-switch-btn ${selectedInterval === 'month' ? 'active' : ''}"
                        data-interval="month" aria-selected="${selectedInterval === 'month'}">
                    <svg class="billing-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                    </svg>
                    ${t('pricing.monthly')}
                </button>
                <button type="button" role="tab" class="billing-switch-btn ${selectedInterval === 'year' ? 'active' : ''}"
                        data-interval="year" aria-selected="${selectedInterval === 'year'}">
                    <svg class="billing-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                    </svg>
                    ${t('pricing.annual')}
                    <span class="billing-badge">${t('pricing.annualSaving')}</span>
                </button>
            </div>
        </div>
    ` : '';

    container.innerHTML = `
        <div class="max-w-4xl mx-auto px-4 py-6">
            ${graceBanner}
            ${subInfoHtml}
            <div class="text-center mb-8">
                <h2 class="text-3xl font-bold mb-2">${t('pricing.title')}</h2>
                <p class="text-base-content/60 text-lg">${t('pricing.subtitle')}</p>
            </div>

            ${toggleHtml}

            <div class="pricing-grid ${1 + filteredPaid.length >= 3 ? 'cols-3' : ''}" id="pricing-grid">
                ${renderTierCard(freeTier, allFeatures, currentTierSlug, false, monthlyMap)}
                ${filteredPaid.map((tier, i) => renderTierCard(tier, allFeatures, currentTierSlug, filteredPaid.length === 1 || i === 0, monthlyMap)).join('')}
            </div>

            ${isActive ? `
                <div class="text-center mb-6 flex justify-center gap-3">
                    <button class="btn btn-error btn-outline btn-sm" id="btn-unsubscribe">
                        ${t('subscription.unsubscribe')}
                    </button>
                </div>
            ` : ''}

            <div class="card bg-base-200 max-w-md mx-auto">
                <div class="card-body">
                    <h3 class="card-title text-base">${t('subscription.promoCode')}</h3>
                    <div class="join w-full">
                        <input type="text" id="promo-input" class="input input-bordered join-item flex-1"
                               placeholder="${t('subscription.promoPlaceholder')}">
                        <button class="btn btn-primary join-item" id="btn-apply-promo">
                            ${t('subscription.applyPromo')}
                        </button>
                    </div>
                    <div id="promo-status" class="text-sm mt-1"></div>
                </div>
            </div>
        </div>

        <!-- Cancel feedback modal -->
        <dialog id="cancel-feedback-modal" class="modal">
            <div class="modal-box">
                <h3 class="font-bold text-lg mb-4">${t('pricing.cancelFeedback')}</h3>
                <div class="space-y-2" id="cancel-feedback-options">
                    ${['too_expensive', 'not_useful', 'found_alternative', 'missing_features', 'other'].map(key => `
                        <label class="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-base-200">
                            <input type="radio" name="cancel-reason" class="radio radio-sm" value="${key}" />
                            <span>${t('pricing.cancel_' + key)}</span>
                        </label>
                    `).join('')}
                </div>
                <div class="form-control mt-3">
                    <textarea id="cancel-reason-text" class="textarea textarea-bordered"
                              placeholder="${t('pricing.cancelReasonPlaceholder')}" rows="2"></textarea>
                </div>
                <div class="modal-action">
                    <button class="btn btn-ghost" id="btn-cancel-keep">${t('pricing.keepSubscription')}</button>
                    <button class="btn btn-error" id="btn-cancel-confirm">${t('pricing.confirmCancel')}</button>
                </div>
            </div>
            <form method="dialog" class="modal-backdrop"><button>close</button></form>
        </dialog>
    `;

    // Event listeners
    document.getElementById('btn-grace-portal')?.addEventListener('click', openPortal);
    document.getElementById('btn-unsubscribe')?.addEventListener('click', showCancelFeedbackModal);

    // Expired renewal — scroll to pricing cards
    const scrollToCards = () => {
        const grid = document.getElementById('pricing-grid');
        if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    document.getElementById('btn-renew-expired')?.addEventListener('click', (e) => {
        e.preventDefault();
        scrollToCards();
    });
    document.getElementById('btn-renew-action')?.addEventListener('click', scrollToCards);
    document.getElementById('btn-apply-promo')?.addEventListener('click', redeemPromo);
    document.getElementById('btn-cancel-keep')?.addEventListener('click', () => {
        document.getElementById('cancel-feedback-modal')?.close();
    });
    document.getElementById('btn-cancel-confirm')?.addEventListener('click', submitCancelFeedback);

    // Billing toggle — segmented control buttons
    document.querySelectorAll('.billing-switch-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const interval = btn.dataset.interval;
            if (interval && interval !== selectedInterval) {
                selectedInterval = interval;
                renderPricingPage(container, tiers);
            }
        });
    });

    // Entrée promo : soumettre avec Entrée
    document.getElementById('promo-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') redeemPromo();
    });

    // Boutons checkout
    document.querySelectorAll('[data-checkout-slug]').forEach(btn => {
        btn.addEventListener('click', () => startCheckout(btn.dataset.checkoutSlug));
    });
}

function renderTierCard(tier, allFeatures, currentTierSlug, isRecommended, monthlyMap) {
    const isFree = tier.price_cents === 0;
    const getBaseSlug = (slug) => slug.replace(/-(?:monthly|yearly|annual)$/, '');
    const isCurrent = currentTierSlug === tier.slug || getBaseSlug(currentTierSlug) === getBaseSlug(tier.slug);
    const features = tier.features || {};
    const interval = tier.interval || 'month';

    // Formatage du prix
    let priceMainHtml, priceSubHtml = '';
    if (isFree) {
        priceMainHtml = `<span class="pricing-amount">0</span><span class="pricing-currency">&euro;</span>`;
    } else if (interval === 'year') {
        const yearEuros = (tier.price_cents / 100).toFixed(2).replace('.', ',');
        const monthlyEquiv = (tier.price_cents / 12 / 100).toFixed(2).replace('.', ',');
        const monthlyPrice = monthlyMap[getBaseSlug(tier.slug)];
        priceMainHtml = `<span class="pricing-amount">${monthlyEquiv}</span><span class="pricing-currency">&euro;</span><span class="pricing-period">${t('pricing.perMonth')}</span>`;
        let savingsLine = '';
        if (monthlyPrice) {
            const monthlyStr = (monthlyPrice / 100).toFixed(2).replace('.', ',');
            const savings = ((monthlyPrice * 12 - tier.price_cents) / 100).toFixed(0);
            savingsLine = `<div class="pricing-savings"><span class="price-original">${monthlyStr}&euro;${t('pricing.perMonth')}</span> <span class="pill pill-success pill-xs">-${savings}&euro;${t('pricing.perYear')}</span></div>`;
        }
        priceSubHtml = `<div class="pricing-billed">${t('pricing.billedAs') || ''} ${yearEuros}&euro;${t('pricing.perYear')}</div>${savingsLine}`;
    } else {
        const euros = (tier.price_cents / 100).toFixed(2).replace('.', ',');
        priceMainHtml = `<span class="pricing-amount">${euros}</span><span class="pricing-currency">&euro;</span><span class="pricing-period">${t('pricing.perMonth')}</span>`;
    }

    // Badges
    const isHighlight = isRecommended && !isFree;
    const badgeHtml = isHighlight
        ? `<div class="pricing-badge-top"><span class="pill pill-primary">${t('pricing.recommended')}</span></div>`
        : isCurrent
            ? `<div class="pricing-badge-top"><span class="pill pill-success">${t('subscription.currentPlan')}</span></div>`
            : `<div class="pricing-badge-top"></div>`;

    // Feature list
    const featureListHtml = allFeatures.map(f => {
        const has = features[f];
        const icon = has
            ? `<svg class="pricing-feat-icon pricing-feat-yes" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`
            : `<svg class="pricing-feat-icon pricing-feat-no" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18 6L6 18M6 6l12 12"/></svg>`;
        return `<li class="pricing-feat-item ${has ? '' : 'pricing-feat-disabled'}">${icon}<span>${t('subscription.features.' + f)}</span></li>`;
    }).join('');

    // Action button
    let actionHtml;
    if (isCurrent) {
        actionHtml = `<button class="btn btn-outline btn-disabled w-full" disabled>${t('pricing.currentPlan')}</button>`;
    } else if (isFree) {
        actionHtml = `<div class="pricing-action-spacer"></div>`;
    } else {
        actionHtml = `<button class="btn btn-primary btn-lg w-full pricing-cta" data-checkout-slug="${escapeAttr(tier.slug)}">${t('pricing.subscribe')}</button>`;
    }

    const cardCls = isHighlight ? 'pricing-card pricing-card-highlight' : 'pricing-card';

    return `
        <div class="${cardCls}">
            ${badgeHtml}
            <div class="pricing-header">
                <h3 class="pricing-name">${escapeHtml(tier.name)}</h3>
            </div>
            <div class="pricing-price-section">
                <div class="pricing-price-main">${priceMainHtml}</div>
                ${priceSubHtml}
            </div>
            <div class="pricing-divider"></div>
            <ul class="pricing-features">
                ${featureListHtml}
            </ul>
            <div class="pricing-action">
                ${actionHtml}
            </div>
        </div>
    `;
}

async function startCheckout(tierSlug) {
    const btn = document.querySelector(`[data-checkout-slug="${tierSlug}"]`);
    if (btn) {
        btn.classList.add('loading');
        btn.disabled = true;
    }

    try {
        const resp = await apiFetch('/api/subscription/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier_slug: tierSlug, interval: selectedInterval }),
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data.url) {
                window.location.href = data.url;
                return;
            }
        }
        const err = await resp.json().catch(() => ({}));
        alert(err.detail || t('subscription.checkoutError'));
    } catch (e) {
        alert(t('subscription.checkoutError'));
    } finally {
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }
}

async function openPortal() {
    try {
        const resp = await fetch('/api/subscription/portal');
        if (resp.ok) {
            const data = await resp.json();
            if (data.url) window.location.href = data.url;
        }
    } catch (e) {
        console.error('Portal error:', e);
    }
}

function showCancelFeedbackModal() {
    const modal = document.getElementById('cancel-feedback-modal');
    if (modal) {
        // Reset state
        modal.querySelectorAll('input[name="cancel-reason"]').forEach(r => r.checked = false);
        const textarea = document.getElementById('cancel-reason-text');
        if (textarea) textarea.value = '';
        modal.showModal();
    }
}

async function submitCancelFeedback() {
    const selected = document.querySelector('input[name="cancel-reason"]:checked');
    const feedback = selected ? selected.value : 'other';
    const reason = document.getElementById('cancel-reason-text')?.value?.trim() || '';

    const confirmBtn = document.getElementById('btn-cancel-confirm');
    if (confirmBtn) { confirmBtn.classList.add('loading'); confirmBtn.disabled = true; }

    try {
        // Submit feedback
        await apiFetch('/api/subscription/cancel-feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedback, reason }),
        });

        // Close modal
        document.getElementById('cancel-feedback-modal')?.close();

        // Open Stripe cancel portal
        const resp = await fetch('/api/subscription/portal?flow=cancel');
        if (resp.ok) {
            const data = await resp.json();
            if (data.url) window.location.href = data.url;
        }
    } catch (e) {
        console.error('Cancel feedback error:', e);
    } finally {
        if (confirmBtn) { confirmBtn.classList.remove('loading'); confirmBtn.disabled = false; }
    }
}

async function redeemPromo() {
    const input = document.getElementById('promo-input');
    const status = document.getElementById('promo-status');
    const code = input?.value.trim();
    if (!code) return;

    status.textContent = '';
    try {
        const resp = await apiFetch('/api/subscription/redeem-promo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        if (resp.ok) {
            const data = await resp.json();
            status.innerHTML = `<span class="text-success">${t('subscription.promoSuccess', { tier: data.tier })}</span>`;
            input.value = '';
            setTimeout(() => window.location.reload(), 1500);
        } else {
            const err = await resp.json().catch(() => ({}));
            status.innerHTML = `<span class="text-error">${err.detail || t('subscription.promoError')}</span>`;
        }
    } catch (e) {
        status.innerHTML = `<span class="text-error">${t('subscription.promoError')}</span>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function escapeAttr(text) {
    return (text || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
