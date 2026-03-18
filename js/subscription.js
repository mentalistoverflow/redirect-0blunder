/**
 * Subscription page — tier comparison, checkout, promo code redemption.
 */

import { t, getLocale } from './i18n.js';
import { apiFetch } from './api.js';
import { isFreeUser } from './user-state.js';

let currentSub = null;

export async function render(container) {
    container.innerHTML = `<div class="card"><div class="spinner"></div></div>`;

    // Load subscription status + tiers in parallel
    try {
        const [statusResp, tiersResp] = await Promise.all([
            fetch('/api/subscription/status'),
            fetch('/api/subscription/tiers'),
        ]);
        currentSub = statusResp.ok ? await statusResp.json() : null;
        const tiers = tiersResp.ok ? await tiersResp.json() : [];

        renderPage(container, tiers);
    } catch (e) {
        container.innerHTML = `<div class="card"><p class="error-text">${t('common.error')}</p></div>`;
    }
}

export function destroy() {
    currentSub = null;
}

function renderPage(container, tiers) {
    const isActive = currentSub && currentSub.status === 'active';
    const tierName = currentSub ? currentSub.tier_name : t('subscription.freeTier');
    const statusLabel = isActive ? t('subscription.active') :
        currentSub && currentSub.status === 'canceled' ? t('subscription.canceled') :
        t('subscription.none');

    let periodInfo = '';
    if (isActive && currentSub.current_period_end) {
        const d = new Date(currentSub.current_period_end);
        if (!isNaN(d.getTime())) {
            const locale = getLocale();
            periodInfo = t('subscription.expiresOn', { date: d.toLocaleDateString(locale) });
            if (currentSub.cancel_at_period_end) {
                periodInfo += ` (${t('subscription.cancelAtEnd')})`;
            }
        }
    }

    // Grace period warning
    const isGracePeriod = currentSub && currentSub.grace_period;
    const graceBannerHtml = isGracePeriod ? `
        <div class="alert alert-warning" style="margin-bottom:16px">
            <span>${t('pricing.gracePeriod')}</span>
            <button class="btn btn-sm btn-warning" id="btn-grace-manage">${t('pricing.updatePayment')}</button>
        </div>` : '';

    container.innerHTML = `
        <div class="settings-layout">
            ${graceBannerHtml}
            <div class="card card-full">
                <h3>${t('subscription.title')}</h3>
                <div class="account-row">
                    <span class="account-label">${t('subscription.currentPlan')}</span>
                    <span class="account-value"><strong>${escapeHtml(tierName)}</strong></span>
                </div>
                <div class="account-row">
                    <span class="account-label">${t('subscription.status')}</span>
                    <span class="account-value">${statusLabel}</span>
                </div>
                ${periodInfo ? `<div class="account-row"><span class="text-muted">${periodInfo}</span></div>` : ''}
                <div class="form-actions" style="margin-top: 16px">
                    ${isActive ? `<button class="btn btn-secondary" id="btn-manage">${t('subscription.manage')}</button>` : ''}
                </div>
            </div>

            <div class="card card-full">
                <h3>${t('subscription.upgrade')}</h3>
                <div class="tiers-grid" id="tiers-grid">
                    ${renderTiers(tiers)}
                </div>
            </div>

            <div class="card card-full">
                <h3>${t('subscription.promoCode')}</h3>
                <div class="form-group" style="display:flex; gap:8px; align-items:flex-end">
                    <input type="text" id="promo-input" class="input" placeholder="${t('subscription.promoPlaceholder')}" style="flex:1">
                    <button class="btn" id="btn-promo">${t('subscription.applyPromo')}</button>
                </div>
                <div id="promo-status" style="margin-top:8px"></div>
            </div>
        </div>
    `;

    // Event listeners
    document.getElementById('btn-manage')?.addEventListener('click', openPortal);
    document.getElementById('btn-grace-manage')?.addEventListener('click', openPortal);
    document.getElementById('btn-promo')?.addEventListener('click', redeemPromo);

    // Checkout buttons
    document.querySelectorAll('[data-checkout-tier]').forEach(btn => {
        btn.addEventListener('click', () => startCheckout(btn.dataset.checkoutTier));
    });
}

function renderTiers(tiers) {
    if (!tiers.length) {
        return `<p class="text-muted">${t('common.loading')}</p>`;
    }

    return tiers.map(tier => {
        const features = tier.features || {};
        const isFree = tier.price_cents === 0;
        const isPremium = !isFree;
        const price = isFree ? t('subscription.freeTier') :
            `<span class="tier-price">${(tier.price_cents / 100).toFixed(2)} ${tier.currency.toUpperCase()}</span><span class="tier-price-suffix">${t('subscription.perMonth')}</span>`;
        const isCurrent = currentSub && currentSub.tier === tier.slug;

        const featureList = ['ai_coaching', 'auto_analysis', 'training', 'advanced_stats']
            .map(f => {
                const has = features[f];
                const icon = has ? '<span style="color:var(--success)">&#10003;</span>' : '<span style="opacity:0.3">&#10007;</span>';
                return `<li>${icon} ${t('subscription.features.' + f)}</li>`;
            }).join('');

        const classes = ['tier-card'];
        if (isCurrent) classes.push('tier-current');
        if (isPremium) classes.push('tier-premium');

        const popularBadge = isPremium ? `<div class="tier-badge-popular">${t('subscription.popular')}</div>` : '';

        return `
            <div class="${classes.join(' ')}">
                ${popularBadge}
                <h4>${escapeHtml(tier.name)}</h4>
                <div>${isFree ? `<div class="tier-price">${price}</div>` : price}</div>
                <ul class="tier-features">${featureList}</ul>
                ${!isFree && !isCurrent ? `<button class="btn" data-checkout-tier="${tier.slug}">${t('subscription.upgrade')}</button>` : ''}
                ${isCurrent ? `<span class="pill pill-success">${t('subscription.currentPlan')}</span>` : ''}
            </div>
        `;
    }).join('');
}

async function startCheckout(tierSlug) {
    try {
        const resp = await apiFetch('/api/subscription/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier_slug: tierSlug }),
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data.url) {
                window.location.href = data.url;
            }
        } else {
            const err = await resp.json().catch(() => ({}));
            alert(err.detail || t('subscription.checkoutError'));
        }
    } catch (e) {
        alert(t('subscription.checkoutError'));
    }
}

async function openPortal() {
    try {
        const resp = await fetch('/api/subscription/portal');
        if (resp.ok) {
            const data = await resp.json();
            if (data.url) window.location.href = data.url;
        }
    } catch (e) {}
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
            status.innerHTML = `<span class="success-text">${t('subscription.promoSuccess', { tier: data.tier })}</span>`;
            input.value = '';
            // Reload page after brief delay
            setTimeout(() => window.location.reload(), 1500);
        } else {
            const err = await resp.json().catch(() => ({}));
            status.innerHTML = `<span class="error-text">${err.detail || t('subscription.promoError')}</span>`;
        }
    } catch (e) {
        status.innerHTML = `<span class="error-text">${t('subscription.promoError')}</span>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}
