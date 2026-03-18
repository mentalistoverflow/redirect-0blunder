/**
 * Contextual upgrade modal — shows what feature is locked + comparison.
 */

import { t } from './i18n.js';
import { showModal, closeModal } from './modal.js';

const featureIcons = {
    ai_coaching: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 13H5l1 9h12l1-9z"/></svg>',
    training: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    advanced_stats: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    auto_analysis: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>',
};

/**
 * Show a rich upgrade modal for a locked feature.
 * @param {string} featureKey - e.g. 'ai_coaching', 'training'
 */
export function showUpgradeModal(featureKey) {
    const featureName = t(`subscription.features.${featureKey}`);
    const icon = featureIcons[featureKey] || '';

    const body = `
        <div class="upgrade-feature-name">${icon} ${featureName}</div>
        <div class="upgrade-compare">
            <div class="upgrade-col">
                <h5>${t('subscription.freeTier')}</h5>
                <ul>
                    <li>${t('subscription.features.auto_analysis')}</li>
                </ul>
            </div>
            <div class="upgrade-col upgrade-col-premium">
                <h5>Premium</h5>
                <ul>
                    <li>${t('subscription.features.ai_coaching')}</li>
                    <li>${t('subscription.features.auto_analysis')}</li>
                    <li>${t('subscription.features.training')}</li>
                    <li>${t('subscription.features.advanced_stats')}</li>
                </ul>
            </div>
        </div>
    `;

    showModal({
        title: t('subscription.upgradePrompt'),
        body,
        cls: 'upgrade-modal',
        actions: [
            {
                label: t('subscription.upgrade'),
                cls: 'btn',
                onClick: () => { closeModal(); location.hash = '#pricing'; },
            },
            {
                label: t('upsell.havePromo'),
                cls: 'btn btn-secondary',
                onClick: () => { closeModal(); location.hash = '#pricing'; },
            },
        ],
    });
}
