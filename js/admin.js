/**
 * Admin page — redesigned tabbed layout:
 *   1. Dashboard (enriched stats: MRR, DAU, conversion)
 *   2. Users (search, dropdown actions, responsive)
 *   3. Auto-analysis management
 *   4. Subscriptions (tiers + promos + revenue)
 *   5. Logs (searchable with filters)
 *   6. Configuration (Stockfish, cheater detection, referral domain)
 *   7. Referrals (parrainage)
 */

import { t, getLocale } from './i18n.js';
import { apiFetch } from './csrf.js';

let _autoAnalysisInterval = null;
let _currentTab = 'dashboard';
let _allTiers = [];
let _userSearchQuery = '';
let _logsPage = 0;
const _logsPerPage = 50;

// ——— Render / Destroy ———

export async function render(container) {
    container.innerHTML = `
        <div class="admin-page">
            <div class="flex items-center justify-between mb-4">
                <h2 class="text-xl font-bold">${t('admin.title')}</h2>
                <div class="flex gap-2">
                    <div class="dropdown dropdown-end">
                        <label tabindex="0" class="btn btn-sm btn-outline">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            ${t('admin.export')}
                        </label>
                        <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-200 rounded-box w-52">
                            <li><a id="btn-export-users">${t('admin.exportUsers')}</a></li>
                            <li><a id="btn-export-games">${t('admin.exportGames')}</a></li>
                            <li><a id="btn-export-revenue">${t('admin.exportRevenue')}</a></li>
                        </ul>
                    </div>
                </div>
            </div>

            <!-- Tab navigation -->
            <div class="tabs tabs-boxed mb-4 flex-wrap" id="admin-tabs">
                <button class="tab tab-active" data-tab="dashboard">${t('admin.tabDashboard')}</button>
                <button class="tab" data-tab="users">${t('admin.tabUsers')}</button>
                <button class="tab" data-tab="auto-analysis">${t('admin.tabAutoAnalysis')}</button>
                <button class="tab" data-tab="subscriptions">${t('admin.tabSubscriptions')}</button>
                <button class="tab" data-tab="logs">${t('admin.tabLogs')}</button>
                <button class="tab" data-tab="config">${t('admin.tabConfig')}</button>
                <button class="tab" data-tab="referrals">${t('admin.tabReferrals')}</button>
            </div>

            <!-- Tab: Dashboard -->
            <div class="admin-tab-content active" id="tab-dashboard">
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" id="admin-stats-grid">
                    <div class="stat bg-base-200 rounded-box p-4">
                        <div class="stat-title">${t('admin.users')}</div>
                        <div class="stat-value text-2xl" id="stat-users">--</div>
                    </div>
                    <div class="stat bg-base-200 rounded-box p-4">
                        <div class="stat-title">${t('admin.games')}</div>
                        <div class="stat-value text-2xl" id="stat-games">--</div>
                    </div>
                    <div class="stat bg-base-200 rounded-box p-4">
                        <div class="stat-title">${t('admin.dau')}</div>
                        <div class="stat-value text-2xl" id="stat-dau">--</div>
                    </div>
                    <div class="stat bg-base-200 rounded-box p-4">
                        <div class="stat-title">${t('admin.stockfish')}</div>
                        <div class="stat-value text-2xl" id="stat-stockfish">--</div>
                    </div>
                </div>
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div class="stat bg-base-200 rounded-box p-4">
                        <div class="stat-title">${t('admin.activeSubscriptions')}</div>
                        <div class="stat-value text-2xl" id="stat-subs">--</div>
                    </div>
                    <div class="stat bg-base-200 rounded-box p-4">
                        <div class="stat-title">${t('admin.mrr')}</div>
                        <div class="stat-value text-2xl" id="stat-mrr">--</div>
                    </div>
                    <div class="stat bg-base-200 rounded-box p-4">
                        <div class="stat-title">${t('admin.conversionRate')}</div>
                        <div class="stat-value text-2xl" id="stat-conversion">--</div>
                    </div>
                    <div class="stat bg-base-200 rounded-box p-4">
                        <div class="stat-title">${t('admin.gamesToday')}</div>
                        <div class="stat-value text-2xl" id="stat-games-today">--</div>
                    </div>
                </div>
            </div>

            <!-- Tab: Users -->
            <div class="admin-tab-content" id="tab-users">
                <div class="card bg-base-200">
                    <div class="card-body">
                    <div class="flex flex-wrap justify-between items-center gap-3 mb-3">
                        <h3 class="card-title text-base">${t('admin.usersTable')}</h3>
                        <div class="flex gap-2 items-center">
                            <input type="text" id="admin-user-search" class="input input-bordered input-sm w-48"
                                   placeholder="${t('admin.searchUsers')}" />
                        </div>
                    </div>
                    <div>
                    <table class="table table-zebra table-sm admin-responsive-table" id="admin-users-table">
                        <thead>
                            <tr>
                                <th>${t('admin.id')}</th>
                                <th>${t('admin.username')}</th>
                                <th>${t('admin.lichess')}</th>
                                <th>${t('admin.registeredAt')}</th>
                                <th>${t('admin.lastLogin')}</th>
                                <th>${t('admin.gamesCount')}</th>
                                <th>${t('admin.status')}</th>
                                <th>${t('admin.actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td colspan="8"><div class="flex justify-center py-2"><span class="loading loading-spinner loading-sm"></span></div></td></tr>
                        </tbody>
                    </table>
                    </div>
                    </div>
                </div>
                <!-- User games panel (hidden by default) -->
                <div class="card bg-base-200 mt-4" id="user-games-panel" style="display:none">
                    <div class="card-body">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="card-title text-base" id="user-games-title">${t('admin.viewGames')}</h3>
                        <button class="btn btn-sm btn-ghost btn-circle" id="btn-close-games-panel">&times;</button>
                    </div>
                    <div class="flex flex-wrap gap-2 items-center mb-3">
                        <input type="date" id="ignore-before-date" class="input input-bordered input-sm" style="width:auto" />
                        <button class="btn btn-sm btn-ghost" id="btn-ignore-before">${t('admin.ignoreBefore')}</button>
                        <button class="btn btn-sm btn-ghost" id="btn-unignore-all">${t('admin.unignoreAll')}</button>
                    </div>
                    <div class="overflow-x-auto">
                    <table class="table table-zebra table-sm" id="user-games-table">
                        <thead>
                            <tr>
                                <th>${t('admin.date')}</th>
                                <th>${t('admin.opponent')}</th>
                                <th>${t('admin.result')}</th>
                                <th>${t('admin.opening')}</th>
                                <th>${t('admin.accuracy')}</th>
                                <th>${t('admin.status')}</th>
                                <th>${t('admin.actions')}</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                    </div>
                    <div class="flex justify-center gap-1 mt-3" id="user-games-pagination"></div>
                    </div>
                </div>
                <!-- Grant subscription panel -->
                <div class="card bg-base-200 mt-4" id="grant-sub-panel" style="display:none">
                    <div class="card-body">
                        <div class="flex justify-between items-center mb-3">
                            <h3 class="card-title text-base" id="grant-sub-title">${t('admin.grantSub')}</h3>
                            <button class="btn btn-sm btn-ghost btn-circle" id="btn-close-grant-panel">&times;</button>
                        </div>
                        <div class="flex flex-wrap gap-3 items-end">
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.promoTier')}</span></label>
                                <select id="grant-tier-select" class="select select-bordered select-sm"></select>
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.promoDuration')}</span></label>
                                <input type="number" id="grant-duration" class="input input-bordered input-sm w-24" min="1" value="30" />
                            </div>
                            <button class="btn btn-sm btn-primary" id="btn-confirm-grant">${t('admin.grantSub')}</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Tab: Auto-analysis -->
            <div class="admin-tab-content" id="tab-auto-analysis">
                <div class="card bg-base-200">
                    <div class="card-body">
                    <h3 class="card-title text-base">${t('admin.autoAnalysis')}</h3>
                    <div class="form-control mb-3">
                        <label class="label cursor-pointer justify-start gap-3">
                            <label class="switch"><input type="checkbox" id="toggle-auto-analysis-default" /><span class="switch-slider"></span></label>
                            <div>
                                <span class="label-text">${t('admin.autoAnalysisDefault')}</span>
                                <div class="text-xs opacity-60">${t('admin.autoAnalysisDefaultDesc')}</div>
                            </div>
                        </label>
                    </div>
                    <div class="flex gap-2 mb-3">
                        <button class="btn btn-sm btn-secondary" id="btn-pause-all">${t('admin.pauseAll')}</button>
                        <button class="btn btn-sm btn-secondary" id="btn-resume-all">${t('admin.resumeAll')}</button>
                    </div>
                    <div class="overflow-x-auto">
                    <table class="table table-zebra table-sm admin-responsive-table" id="auto-analysis-table">
                        <thead>
                            <tr>
                                <th>${t('admin.username')}</th>
                                <th>${t('admin.lichess')}</th>
                                <th>${t('admin.autoAnalysisStatus')}</th>
                                <th>${t('admin.autoAnalysisProgress')}</th>
                                <th>${t('admin.autoAnalysisCurrentGame')}</th>
                                <th>${t('admin.actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td colspan="6"><div class="flex justify-center py-2"><span class="loading loading-spinner loading-sm"></span></div></td></tr>
                        </tbody>
                    </table>
                    </div>
                    </div>
                </div>
            </div>

            <!-- Tab: Subscriptions (tiers + promos + stats) -->
            <div class="admin-tab-content" id="tab-subscriptions">
                <!-- Subscription stats -->
                <div id="sub-stats-container" class="mb-4"></div>

                <!-- Tiers management -->
                <div class="card bg-base-200 mb-4">
                    <div class="card-body">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="card-title text-base">${t('admin.tierManagement')}</h3>
                        <button class="btn btn-sm btn-primary" id="btn-add-tier">${t('admin.addTier')}</button>
                    </div>
                    <div id="tier-form-container" style="display:none" class="mb-4 space-y-3">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.tierName')}</span></label>
                                <input type="text" id="tier-name" class="input input-bordered input-sm" placeholder="Premium" />
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.tierSlug')}</span></label>
                                <input type="text" id="tier-slug" class="input input-bordered input-sm" placeholder="premium" />
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.tierPrice')}</span></label>
                                <input type="number" id="tier-price" class="input input-bordered input-sm" min="0" value="999" />
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.tierStripePriceId')}</span></label>
                                <input type="text" id="tier-stripe-price" class="input input-bordered input-sm" placeholder="price_..." />
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.tierInterval')}</span></label>
                                <select id="tier-interval" class="select select-bordered select-sm">
                                    <option value="month">${t('pricing.monthly')}</option>
                                    <option value="year">${t('pricing.annual')}</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-control">
                            <label class="label"><span class="label-text">${t('admin.tierFeatures')}</span></label>
                            <div class="flex flex-wrap gap-3">
                                <label class="label cursor-pointer gap-2"><input type="checkbox" id="feat-ai-coaching" class="checkbox checkbox-sm" /> <span class="label-text">${t('subscription.features.ai_coaching')}</span></label>
                                <label class="label cursor-pointer gap-2"><input type="checkbox" id="feat-auto-analysis" class="checkbox checkbox-sm" /> <span class="label-text">${t('subscription.features.auto_analysis')}</span></label>
                                <label class="label cursor-pointer gap-2"><input type="checkbox" id="feat-training" class="checkbox checkbox-sm" /> <span class="label-text">${t('subscription.features.training')}</span></label>
                                <label class="label cursor-pointer gap-2"><input type="checkbox" id="feat-advanced-stats" class="checkbox checkbox-sm" /> <span class="label-text">${t('subscription.features.advanced_stats')}</span></label>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button class="btn btn-sm btn-primary" id="btn-save-tier">${t('admin.save')}</button>
                            <button class="btn btn-sm btn-ghost" id="btn-cancel-tier">${t('admin.cancel')}</button>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                    <table class="table table-zebra table-sm admin-responsive-table" id="admin-tiers-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>${t('admin.tierName')}</th>
                                <th>Slug</th>
                                <th>${t('admin.tierInterval')}</th>
                                <th>${t('admin.tierPrice')}</th>
                                <th>Stripe</th>
                                <th>${t('admin.status')}</th>
                                <th>${t('admin.actions')}</th>
                            </tr>
                        </thead>
                        <tbody><tr><td colspan="8"><div class="flex justify-center py-2"><span class="loading loading-spinner loading-sm"></span></div></td></tr></tbody>
                    </table>
                    </div>
                    </div>
                </div>

                <!-- Promo codes management -->
                <div class="card bg-base-200">
                    <div class="card-body">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="card-title text-base">${t('admin.promoManagement')}</h3>
                        <button class="btn btn-sm btn-primary" id="btn-add-promo">${t('admin.addPromo')}</button>
                    </div>
                    <div id="promo-form-container" style="display:none" class="mb-4 space-y-3">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.promoCode')}</span></label>
                                <input type="text" id="promo-code" class="input input-bordered input-sm" placeholder="WELCOME2026" />
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.promoTier')}</span></label>
                                <select id="promo-tier-select" class="select select-bordered select-sm"></select>
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.promoDuration')}</span></label>
                                <input type="number" id="promo-duration" class="input input-bordered input-sm" min="1" value="30" />
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.promoMaxUses')}</span></label>
                                <input type="number" id="promo-max-uses" class="input input-bordered input-sm" min="1" value="10" />
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button class="btn btn-sm btn-primary" id="btn-save-promo">${t('admin.save')}</button>
                            <button class="btn btn-sm btn-ghost" id="btn-cancel-promo">${t('admin.cancel')}</button>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                    <table class="table table-zebra table-sm admin-responsive-table" id="admin-promos-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>${t('admin.promoCode')}</th>
                                <th>${t('admin.promoTier')}</th>
                                <th>${t('admin.promoDuration')}</th>
                                <th>${t('admin.promoUses')}</th>
                                <th>${t('admin.status')}</th>
                                <th>${t('admin.actions')}</th>
                            </tr>
                        </thead>
                        <tbody><tr><td colspan="7"><div class="flex justify-center py-2"><span class="loading loading-spinner loading-sm"></span></div></td></tr></tbody>
                    </table>
                    </div>
                    </div>
                </div>

                <!-- Analytics section -->
                <div class="card bg-base-200 mt-4">
                    <div class="card-body">
                        <h3 class="card-title text-base">${t('admin.funnel')}</h3>
                        <div id="analytics-container">
                            <div class="flex justify-center py-4"><span class="loading loading-spinner loading-sm"></span></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Tab: Logs (searchable) -->
            <div class="admin-tab-content" id="tab-logs">
                <div class="card bg-base-200">
                    <div class="card-body">
                    <h3 class="card-title text-base mb-3">${t('admin.activityLogs')}</h3>
                    <div class="flex flex-wrap gap-2 items-end mb-4">
                        <div class="form-control">
                            <input type="text" id="logs-search-q" class="input input-bordered input-sm w-48"
                                   placeholder="${t('admin.logsSearchPlaceholder')}" />
                        </div>
                        <div class="form-control">
                            <select id="logs-search-type" class="select select-bordered select-sm" style="min-width:160px">
                                <option value="">${t('admin.logsAllTypes')}</option>
                                <option value="game">${t('admin.logsTypeGame')}</option>
                                <option value="registration">${t('admin.logsTypeRegistration')}</option>
                                <option value="subscription">${t('admin.logsTypeSubscription')}</option>
                            </select>
                        </div>
                        <div class="form-control">
                            <input type="text" id="logs-search-user" class="input input-bordered input-sm w-36"
                                   placeholder="${t('admin.logsFilterUser')}" />
                        </div>
                        <div class="form-control">
                            <input type="date" id="logs-date-from" class="input input-bordered input-sm" />
                        </div>
                        <div class="form-control">
                            <input type="date" id="logs-date-to" class="input input-bordered input-sm" />
                        </div>
                        <button class="btn btn-sm btn-primary" id="btn-logs-search">${t('admin.logsSearch')}</button>
                        <button class="btn btn-sm btn-ghost" id="btn-logs-clear">${t('admin.logsClear')}</button>
                    </div>
                    <div id="logs-container">
                        <div class="opacity-60 text-sm py-8 text-center">${t('admin.logsEmptyHint')}</div>
                    </div>
                    </div>
                </div>
            </div>

            <!-- Tab: Configuration -->
            <div class="admin-tab-content" id="tab-config">
                <div class="card bg-base-200 mb-4">
                    <div class="card-body">
                    <h3 class="card-title text-base mb-3">${t('admin.stockfishConfig')}</h3>
                    <div class="form-control mb-3" style="max-width:300px">
                        <label class="label" for="stockfish-depth"><span class="label-text">${t('admin.stockfishDepth')}</span></label>
                        <input type="number" id="stockfish-depth" class="input input-bordered input-sm" min="8" max="30" value="18" />
                        <label class="label"><span class="label-text-alt opacity-60">${t('admin.stockfishDepthHint')}</span></label>
                    </div>
                    <div class="flex items-center gap-2">
                        <button class="btn btn-sm btn-primary" id="btn-save-stockfish">${t('admin.save')}</button>
                        <span id="stockfish-save-status" class="text-sm"></span>
                    </div>
                    </div>
                </div>
                <div class="card bg-base-200 mb-4">
                    <div class="card-body">
                    <h3 class="card-title text-base mb-2">${t('admin.layoutCustomization') || 'Personnalisation du layout'}</h3>
                    <div class="text-sm opacity-60 mb-3">${t('admin.layoutCustomizationDesc') || 'Permet aux utilisateurs de réorganiser les modules des pages Review et Dashboard par glisser-déposer.'}</div>
                    <div class="form-control">
                        <label class="label cursor-pointer justify-start gap-3">
                            <input type="checkbox" id="layout-customization-toggle" class="toggle toggle-primary" checked />
                            <span class="label-text">${t('admin.layoutCustomizationEnabled') || 'Activé'}</span>
                        </label>
                    </div>
                    </div>
                </div>
                <div class="card bg-base-200 mb-4">
                    <div class="card-body">
                    <h3 class="card-title text-base mb-2">${t('admin.cheaterDetection')}</h3>
                    <div class="text-sm opacity-60 mb-3">${t('admin.cheaterDetectionDesc')}</div>
                    <div class="form-control">
                        <select id="cheater-detection-mode" class="select select-bordered select-sm" style="min-width:200px">
                            <option value="all">${t('admin.cheaterAll')}</option>
                            <option value="admin">${t('admin.cheaterAdminOnly')}</option>
                            <option value="off">${t('admin.cheaterOff')}</option>
                        </select>
                    </div>
                    </div>
                </div>
                <div class="card bg-base-200 mb-4">
                    <div class="card-body">
                    <h3 class="card-title text-base mb-3">${t('admin.claudeConfig')}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                        <div class="form-control">
                            <label class="label"><span class="label-text">${t('admin.claudeTimeout')}</span></label>
                            <input type="number" id="claude-timeout" class="input input-bordered input-sm" min="5" max="120" value="15" />
                        </div>
                        <div class="form-control">
                            <label class="label"><span class="label-text">${t('admin.claudePostGameTimeout')}</span></label>
                            <input type="number" id="claude-post-game-timeout" class="input input-bordered input-sm" min="30" max="300" value="60" />
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button class="btn btn-sm btn-primary" id="btn-save-claude-config">${t('admin.save')}</button>
                        <span id="claude-save-status" class="text-sm"></span>
                    </div>
                    </div>
                </div>
                <div class="card bg-base-200">
                    <div class="card-body">
                    <h3 class="card-title text-base mb-2">${t('admin.referralDomainConfig')}</h3>
                    <div class="text-sm opacity-60 mb-3">${t('admin.referralDomainDesc')}</div>
                    <div class="flex gap-2 items-center">
                        <input type="text" id="referral-domain" class="input input-bordered input-sm" style="max-width:400px;flex:1"
                               placeholder="https://example.com" />
                        <button class="btn btn-sm btn-primary" id="btn-save-referral-domain">${t('admin.save')}</button>
                        <span id="referral-domain-status" class="text-sm"></span>
                    </div>
                    </div>
                </div>
                <div class="card bg-base-200 mt-4">
                    <div class="card-body">
                    <h3 class="card-title text-base mb-3">${t('admin.brandingTitle')}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                        <div class="form-control">
                            <label class="label"><span class="label-text">${t('admin.siteName')}</span></label>
                            <input type="text" id="branding-site-name" class="input input-bordered input-sm" maxlength="100" />
                        </div>
                        <div class="form-control">
                            <label class="label"><span class="label-text">${t('admin.siteDescription')}</span></label>
                            <input type="text" id="branding-site-desc" class="input input-bordered input-sm" maxlength="300" />
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                        <div class="form-control">
                            <label class="label"><span class="label-text">${t('admin.sidebarLogo')}</span></label>
                            <div class="text-xs opacity-60 mb-1">PNG ou SVG — max 200 Ko — hauteur idéale : 28×28 px</div>
                            <div class="flex items-center gap-3">
                                <img id="branding-logo-preview" src="/branding/logo" alt="" style="width:28px;height:28px;object-fit:contain;border-radius:4px;background:rgba(255,255,255,0.05)" />
                                <input type="file" id="branding-logo-file" accept=".png,.svg,image/png,image/svg+xml" class="file-input file-input-bordered file-input-sm" style="max-width:250px" />
                            </div>
                        </div>
                        <div class="form-control">
                            <label class="label"><span class="label-text">${t('admin.pwaIcon')}</span></label>
                            <div class="text-xs opacity-60 mb-1">PNG uniquement — exactement 512×512 px — max 500 Ko</div>
                            <div class="flex items-center gap-3">
                                <img id="branding-icon-preview" src="/branding/icon-192.png" alt="" style="width:40px;height:40px;object-fit:contain;border-radius:8px;background:rgba(255,255,255,0.05)" />
                                <input type="file" id="branding-icon-file" accept=".png,image/png" class="file-input file-input-bordered file-input-sm" style="max-width:250px" />
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button class="btn btn-sm btn-primary" id="btn-save-branding">${t('admin.save')}</button>
                        <span id="branding-save-status" class="text-sm"></span>
                    </div>
                    </div>
                </div>
            </div>

            <!-- Tab: Referrals -->
            <div class="admin-tab-content" id="tab-referrals">
                <div class="card bg-base-200">
                    <div class="card-body">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="card-title text-base">${t('admin.referralManagement')}</h3>
                        <button class="btn btn-sm btn-primary" id="btn-add-referral">${t('admin.addReferral')}</button>
                    </div>
                    <div id="referral-form-container" style="display:none" class="mb-4 space-y-3">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.referralLabel')}</span></label>
                                <input type="text" id="referral-label" class="input input-bordered input-sm" placeholder="Facebook Ads" />
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.referralCode')}</span></label>
                                <input type="text" id="referral-code" class="input input-bordered input-sm" placeholder="fb-ads-2026" />
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.referralTargetUrl')}</span></label>
                                <input type="text" id="referral-target" class="input input-bordered input-sm" value="/" />
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.utmSource')}</span></label>
                                <input type="text" id="referral-utm-source" class="input input-bordered input-sm" placeholder="facebook, google, newsletter..." />
                                <label class="label"><span class="label-text-alt opacity-60">${t('admin.utmSourceHint')}</span></label>
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.utmMedium')}</span></label>
                                <input type="text" id="referral-utm-medium" class="input input-bordered input-sm" placeholder="cpc, email, social, banner..." />
                                <label class="label"><span class="label-text-alt opacity-60">${t('admin.utmMediumHint')}</span></label>
                            </div>
                            <div class="form-control">
                                <label class="label"><span class="label-text">${t('admin.utmCampaign')}</span></label>
                                <input type="text" id="referral-utm-campaign" class="input input-bordered input-sm" placeholder="promo-été-2026..." />
                                <label class="label"><span class="label-text-alt opacity-60">${t('admin.utmCampaignHint')}</span></label>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button class="btn btn-sm btn-primary" id="btn-save-referral">${t('admin.save')}</button>
                            <button class="btn btn-sm btn-ghost" id="btn-cancel-referral">${t('admin.cancel')}</button>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                    <table class="table table-zebra table-sm admin-responsive-table" id="admin-referrals-table">
                        <thead>
                            <tr>
                                <th>${t('admin.referralLabel')}</th>
                                <th>${t('admin.referralLink')}</th>
                                <th>${t('admin.referralClicks')}</th>
                                <th>${t('admin.referralRegistrations')}</th>
                                <th>${t('admin.referralSubscriptions')}</th>
                                <th>${t('admin.status')}</th>
                                <th>${t('admin.actions')}</th>
                            </tr>
                        </thead>
                        <tbody><tr><td colspan="7"><div class="flex justify-center py-2"><span class="loading loading-spinner loading-sm"></span></div></td></tr></tbody>
                    </table>
                    </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Tab switching
    document.querySelectorAll('#admin-tabs .tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Load data for initial tab and background data
    await Promise.all([loadEnrichedStats(), loadUsers(), loadStockfishSettings(), loadAutoAnalysis(), loadTiers(), loadPromos()]);

    // Event listeners — Users
    const searchInput = document.getElementById('admin-user-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            _userSearchQuery = searchInput.value.trim().toLowerCase();
            loadUsers();
        }, 300));
    }

    // Event listeners — Auto-analysis
    document.getElementById('toggle-auto-analysis-default')?.addEventListener('change', toggleAutoAnalysisDefault);
    document.getElementById('btn-pause-all')?.addEventListener('click', pauseAllAnalysis);
    document.getElementById('btn-resume-all')?.addEventListener('click', resumeAllAnalysis);

    // Event listeners — Subscriptions
    document.getElementById('btn-add-tier')?.addEventListener('click', showTierForm);
    document.getElementById('btn-cancel-tier')?.addEventListener('click', hideTierForm);
    document.getElementById('btn-save-tier')?.addEventListener('click', saveTier);
    document.getElementById('btn-add-promo')?.addEventListener('click', showPromoForm);
    document.getElementById('btn-cancel-promo')?.addEventListener('click', hidePromoForm);
    document.getElementById('btn-save-promo')?.addEventListener('click', savePromo);

    // Event listeners — Logs
    document.getElementById('btn-logs-search')?.addEventListener('click', () => { _logsPage = 0; searchLogs(); });
    document.getElementById('btn-logs-clear')?.addEventListener('click', clearLogsSearch);
    document.getElementById('logs-search-q')?.addEventListener('keydown', e => { if (e.key === 'Enter') { _logsPage = 0; searchLogs(); } });

    // Event listeners — Config
    document.getElementById('btn-save-stockfish')?.addEventListener('click', saveStockfishSettings);
    document.getElementById('cheater-detection-mode')?.addEventListener('change', onCheaterDetectionChange);
    document.getElementById('layout-customization-toggle')?.addEventListener('change', onLayoutCustomizationToggle);
    document.getElementById('btn-save-claude-config')?.addEventListener('click', saveClaudeConfig);
    document.getElementById('btn-save-referral-domain')?.addEventListener('click', saveReferralDomain);
    document.getElementById('btn-save-branding')?.addEventListener('click', saveBranding);
    loadBranding();

    // Event listeners — Referrals
    document.getElementById('btn-add-referral')?.addEventListener('click', showReferralForm);
    document.getElementById('btn-cancel-referral')?.addEventListener('click', hideReferralForm);
    document.getElementById('btn-save-referral')?.addEventListener('click', saveReferral);

    // Event listeners — User games panel
    document.getElementById('btn-close-games-panel')?.addEventListener('click', hideUserGamesPanel);
    document.getElementById('btn-ignore-before')?.addEventListener('click', ignoreGamesBefore);
    document.getElementById('btn-unignore-all')?.addEventListener('click', unignoreAllGames);
    document.getElementById('btn-close-grant-panel')?.addEventListener('click', hideGrantPanel);
    document.getElementById('btn-confirm-grant')?.addEventListener('click', confirmGrantSubscription);

    // Event listeners — Exports
    document.getElementById('btn-export-users')?.addEventListener('click', () => downloadExport('users'));
    document.getElementById('btn-export-games')?.addEventListener('click', () => downloadExport('games'));
    document.getElementById('btn-export-revenue')?.addEventListener('click', () => downloadExport('revenue'));

    // Auto-refresh auto-analysis every 10s
    _autoAnalysisInterval = setInterval(() => {
        if (_currentTab === 'auto-analysis') loadAutoAnalysis();
    }, 10000);
}

export function destroy() {
    if (_autoAnalysisInterval) {
        clearInterval(_autoAnalysisInterval);
        _autoAnalysisInterval = null;
    }
    _userSearchQuery = '';
}

// ——— Tab switching ———

function switchTab(tabId) {
    _currentTab = tabId;
    document.querySelectorAll('#admin-tabs .tab').forEach(btn => {
        btn.classList.toggle('tab-active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.admin-tab-content').forEach(el => {
        el.classList.toggle('active', el.id === `tab-${tabId}`);
    });

    if (tabId === 'dashboard') loadEnrichedStats();
    if (tabId === 'auto-analysis') loadAutoAnalysis();
    if (tabId === 'users') loadUsers();
    if (tabId === 'subscriptions') { loadTiers(); loadPromos(); loadAnalytics(); }
    if (tabId === 'referrals') loadReferrals();
    // Logs: NOT auto-loaded — user must search
}

// ——— Dashboard tab (enriched stats) ———

async function loadEnrichedStats() {
    try {
        const resp = await apiFetch('/api/admin/platform-stats');
        if (!resp.ok) return;
        const stats = await resp.json();
        const el = (id) => document.getElementById(id);

        if (el('stat-users')) el('stat-users').textContent = stats.total_users ?? '--';
        if (el('stat-games')) el('stat-games').textContent = stats.total_games ?? '--';
        if (el('stat-dau')) el('stat-dau').textContent = stats.dau ?? 0;
        if (el('stat-subs')) el('stat-subs').textContent = stats.active_subscriptions ?? 0;
        if (el('stat-mrr')) {
            const mrr = (stats.mrr_cents || 0) / 100;
            el('stat-mrr').textContent = mrr > 0 ? `${mrr.toFixed(2)} \u20ac` : '0 \u20ac';
        }
        if (el('stat-conversion')) el('stat-conversion').textContent = `${stats.conversion_rate ?? 0}%`;
        if (el('stat-games-today')) el('stat-games-today').textContent = stats.games_today ?? 0;
        if (el('stat-stockfish')) {
            el('stat-stockfish').textContent = stats.stockfish_ready ? 'OK' : 'Off';
            el('stat-stockfish').style.color = stats.stockfish_ready
                ? 'oklch(var(--su))' : 'oklch(var(--er))';
        }
    } catch (e) {
        console.error('Admin enriched stats error:', e);
    }
}

// ——— Users tab ———

async function loadUsers() {
    const tbody = document.querySelector('#admin-users-table tbody');
    if (!tbody) return;

    try {
        const resp = await apiFetch('/api/admin/users');
        if (!resp.ok) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-error">${t('admin.loadError')}</td></tr>`;
            return;
        }
        let users = await resp.json();

        // Client-side search filter
        if (_userSearchQuery) {
            users = users.filter(u =>
                (u.username || '').toLowerCase().includes(_userSearchQuery) ||
                (u.lichess_username || '').toLowerCase().includes(_userSearchQuery)
            );
        }

        if (!users.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-sm opacity-60">${t('admin.noUsers')}</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(u => {
            const createdAt = u.created_at ? formatDate(u.created_at) : '--';
            const lastLogin = u.last_login ? formatDate(u.last_login) : t('admin.never');
            const isActive = u.is_active !== 0;
            const isAdmin = !!u.is_admin;

            let statusBadges = '';
            if (isAdmin) statusBadges += `<span class="pill pill-primary pill-xs">${t('admin.badgeAdmin')}</span> `;
            statusBadges += isActive
                ? `<span class="pill pill-success pill-xs">${t('admin.badgeActive')}</span>`
                : `<span class="pill pill-error pill-xs">${t('admin.badgeDisabled')}</span>`;

            return `
                <tr class="${!isActive ? 'opacity-50' : ''}">
                    <td data-label="${t('admin.id')}" class="opacity-60">${u.id}</td>
                    <td data-label="${t('admin.username')}"><strong>${escapeHtml(u.username)}</strong></td>
                    <td data-label="${t('admin.lichess')}">${u.lichess_username ? escapeHtml(u.lichess_username) : '<span class="opacity-40">--</span>'}</td>
                    <td data-label="${t('admin.registeredAt')}" class="opacity-60 text-xs">${createdAt}</td>
                    <td data-label="${t('admin.lastLogin')}" class="opacity-60 text-xs">${lastLogin}</td>
                    <td data-label="${t('admin.gamesCount')}">${u.games_count}</td>
                    <td data-label="${t('admin.status')}">${statusBadges}</td>
                    <td data-label="${t('admin.actions')}">
                        <div class="dropdown dropdown-end dropdown-top">
                            <label tabindex="0" class="btn btn-xs btn-ghost">\u2026</label>
                            <ul tabindex="0" class="dropdown-content z-[1] menu p-1 shadow bg-base-300 rounded-box w-48">
                                <li><a class="btn-toggle-active" data-uid="${u.id}">${isActive ? t('admin.deactivate') : t('admin.activate')}</a></li>
                                <li><a class="btn-toggle-admin" data-uid="${u.id}">${isAdmin ? t('admin.demote') : t('admin.promote')}</a></li>
                                <li><a class="btn-view-games" data-uid="${u.id}" data-username="${escapeHtml(u.username)}">${t('admin.viewGames')}</a></li>
                                <li><a class="btn-grant-sub" data-uid="${u.id}" data-username="${escapeHtml(u.username)}">${t('admin.grantSub')}</a></li>
                                <li><a class="btn-revoke-sub" data-uid="${u.id}">${t('admin.revokeSub')}</a></li>
                                <li><a class="btn-delete-games" data-uid="${u.id}" data-username="${escapeHtml(u.username)}" data-count="${u.games_count}">${t('admin.clearGames')}</a></li>
                                <li><a class="btn-delete-user text-error" data-uid="${u.id}" data-username="${escapeHtml(u.username)}">${t('admin.deleteUser')}</a></li>
                            </ul>
                        </div>
                    </td>
                </tr>`;
        }).join('');

        // Bind events via delegation
        tbody.querySelectorAll('.btn-toggle-active').forEach(btn =>
            btn.addEventListener('click', () => toggleActive(parseInt(btn.dataset.uid))));
        tbody.querySelectorAll('.btn-toggle-admin').forEach(btn =>
            btn.addEventListener('click', () => toggleAdmin(parseInt(btn.dataset.uid))));
        tbody.querySelectorAll('.btn-view-games').forEach(btn =>
            btn.addEventListener('click', () => showUserGames(parseInt(btn.dataset.uid), btn.dataset.username)));
        tbody.querySelectorAll('.btn-delete-games').forEach(btn =>
            btn.addEventListener('click', () => deleteGames(parseInt(btn.dataset.uid), btn.dataset.username, parseInt(btn.dataset.count))));
        tbody.querySelectorAll('.btn-delete-user').forEach(btn =>
            btn.addEventListener('click', () => deleteUser(parseInt(btn.dataset.uid), btn.dataset.username)));
        tbody.querySelectorAll('.btn-grant-sub').forEach(btn =>
            btn.addEventListener('click', () => showGrantPanel(parseInt(btn.dataset.uid), btn.dataset.username)));
        tbody.querySelectorAll('.btn-revoke-sub').forEach(btn =>
            btn.addEventListener('click', () => revokeSubscription(parseInt(btn.dataset.uid))));
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-error">${t('admin.loadError')}</td></tr>`;
    }
}

async function toggleActive(userId) {
    try {
        const resp = await apiFetch(`/api/admin/users/${userId}/toggle-active`, { method: 'POST' });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); return; }
        await loadUsers();
    } catch (e) { alert(t('admin.networkError')); }
}

async function toggleAdmin(userId) {
    try {
        const resp = await apiFetch(`/api/admin/users/${userId}/toggle-admin`, { method: 'POST' });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); return; }
        await loadUsers();
    } catch (e) { alert(t('admin.networkError')); }
}

async function deleteGames(userId, username, count) {
    if (!confirm(t('admin.confirmDeleteGames', { count, username }))) return;
    try {
        const resp = await apiFetch(`/api/admin/users/${userId}/games`, { method: 'DELETE' });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); return; }
        const data = await resp.json();
        alert(t('admin.gamesDeleted', { count: data.deleted }));
        await loadEnrichedStats();
        await loadUsers();
    } catch (e) { alert(t('admin.networkError')); }
}

async function deleteUser(userId, username) {
    if (!confirm(t('admin.confirmDeleteUser', { username }))) return;
    try {
        const resp = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); return; }
        await loadEnrichedStats();
        await loadUsers();
    } catch (e) { alert(t('admin.networkError')); }
}

// ——— Grant/Revoke subscription ———

let _grantUserId = null;

function showGrantPanel(userId, username) {
    _grantUserId = userId;
    document.getElementById('grant-sub-panel').style.display = '';
    document.getElementById('grant-sub-title').textContent = `${t('admin.grantSub')} \u2014 ${username}`;
    const select = document.getElementById('grant-tier-select');
    if (select) {
        select.innerHTML = _allTiers
            .filter(t => t.is_active)
            .map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)
            .join('');
    }
}

function hideGrantPanel() {
    document.getElementById('grant-sub-panel').style.display = 'none';
    _grantUserId = null;
}

async function confirmGrantSubscription() {
    if (!_grantUserId) return;
    const tierId = parseInt(document.getElementById('grant-tier-select')?.value);
    const duration = parseInt(document.getElementById('grant-duration')?.value) || 30;
    if (!tierId) return;

    try {
        const resp = await apiFetch(`/api/admin/users/${_grantUserId}/subscription/grant`, {
            method: 'POST',
            body: { tier_id: tierId, duration_days: duration },
        });
        if (resp.ok) {
            hideGrantPanel();
            await loadUsers();
        } else {
            const err = await resp.json().catch(() => ({}));
            alert(err.detail || t('common.error'));
        }
    } catch (e) { alert(t('admin.networkError')); }
}

async function revokeSubscription(userId) {
    if (!confirm(t('admin.confirmRevokeSub'))) return;
    try {
        const resp = await apiFetch(`/api/admin/users/${userId}/subscription/revoke`, { method: 'POST' });
        if (resp.ok) await loadUsers();
        else { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); }
    } catch (e) { alert(t('admin.networkError')); }
}

// ——— User games panel ———

let _currentGamesUserId = null;
let _currentGamesUsername = '';
let _gamesPage = 0;
const _gamesPerPage = 20;

async function showUserGames(userId, username) {
    _currentGamesUserId = userId;
    _currentGamesUsername = username;
    _gamesPage = 0;
    document.getElementById('user-games-panel').style.display = '';
    document.getElementById('user-games-title').textContent = t('admin.gamesOf', { username });
    const dateInput = document.getElementById('ignore-before-date');
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
    await loadUserGamesPage();
}

function hideUserGamesPanel() {
    document.getElementById('user-games-panel').style.display = 'none';
    _currentGamesUserId = null;
}

async function loadUserGamesPage(page) {
    if (page !== undefined) _gamesPage = page;
    const tbody = document.querySelector('#user-games-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7"><div class="flex justify-center py-2"><span class="loading loading-spinner loading-sm"></span></div></td></tr>';

    try {
        const resp = await apiFetch(`/api/admin/users/${_currentGamesUserId}/games?limit=${_gamesPerPage}&offset=${_gamesPage * _gamesPerPage}`);
        if (!resp.ok) { tbody.innerHTML = `<tr><td colspan="7" class="text-error">${t('admin.loadError')}</td></tr>`; renderGamesPagination(0); return; }
        const data = await resp.json();
        const games = data.games || [];
        const totalPages = Math.ceil((data.total || 0) / _gamesPerPage);

        if (!games.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="opacity-60">${t('admin.noGames')}</td></tr>`;
            renderGamesPagination(0);
            return;
        }

        tbody.innerHTML = games.map(g => {
            const isIgnored = !!g.ignored;
            return `
                <tr class="${isIgnored ? 'opacity-40' : ''}">
                    <td class="text-xs">${g.played_at ? formatDate(g.played_at) : '--'}</td>
                    <td>${escapeHtml(g.opponent || '--')}</td>
                    <td>${g.result || '--'}</td>
                    <td class="text-xs">${escapeHtml(g.opening_name || '--')}</td>
                    <td>${g.accuracy_pct != null ? `${Math.round(g.accuracy_pct)}%` : '--'}</td>
                    <td>${isIgnored ? `<span class="pill pill-error pill-xs">${t('admin.ignored')}</span>` : `<span class="pill pill-success pill-xs">${t('admin.active')}</span>`}</td>
                    <td><button class="btn btn-xs ${isIgnored ? 'btn-primary' : 'btn-ghost'} btn-toggle-ignored" data-gid="${g.id}">${isIgnored ? t('admin.unignore') : t('admin.ignore')}</button></td>
                </tr>`;
        }).join('');

        tbody.querySelectorAll('.btn-toggle-ignored').forEach(btn =>
            btn.addEventListener('click', () => toggleGameIgnored(parseInt(btn.dataset.gid))));
        renderGamesPagination(totalPages);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-error">${t('admin.loadError')}</td></tr>`;
        renderGamesPagination(0);
    }
}

function renderGamesPagination(totalPages) {
    const pagDiv = document.getElementById('user-games-pagination');
    if (!pagDiv) return;
    if (totalPages <= 1) { pagDiv.innerHTML = ''; return; }

    const p = _gamesPage;
    let html = '';
    html += `<button class="btn btn-ghost btn-xs" ${p === 0 ? 'disabled' : ''} data-page="${p - 1}">&laquo;</button>`;
    const start = Math.max(0, p - 3);
    const end = Math.min(totalPages, p + 4);
    for (let i = start; i < end; i++) {
        html += `<button class="btn btn-xs ${i === p ? 'btn-primary' : 'btn-ghost'}" data-page="${i}">${i + 1}</button>`;
    }
    html += `<button class="btn btn-ghost btn-xs" ${p >= totalPages - 1 ? 'disabled' : ''} data-page="${p + 1}">&raquo;</button>`;
    pagDiv.innerHTML = html;
    pagDiv.querySelectorAll('.btn:not([disabled])').forEach(btn =>
        btn.addEventListener('click', () => loadUserGamesPage(parseInt(btn.dataset.page))));
}

async function toggleGameIgnored(gameId) {
    try {
        const resp = await apiFetch(`/api/admin/games/${gameId}/toggle-ignored`, { method: 'POST' });
        if (resp.ok && _currentGamesUserId) { await loadUserGamesPage(); await loadUsers(); }
    } catch (e) { console.error('Toggle ignored error:', e); }
}

async function ignoreGamesBefore() {
    const date = document.getElementById('ignore-before-date')?.value;
    if (!date || !_currentGamesUserId) return;
    if (!confirm(t('admin.confirmIgnoreBefore', { username: _currentGamesUsername, date }))) return;
    try {
        const resp = await apiFetch(`/api/admin/users/${_currentGamesUserId}/games/ignore-before`, {
            method: 'POST', body: { before_date: date },
        });
        if (resp.ok) { _gamesPage = 0; await loadUserGamesPage(); await loadUsers(); }
    } catch (e) { console.error('Ignore before error:', e); }
}

async function unignoreAllGames() {
    if (!_currentGamesUserId) return;
    if (!confirm(t('admin.confirmUnignoreAll', { username: _currentGamesUsername }))) return;
    try {
        const resp = await apiFetch(`/api/admin/users/${_currentGamesUserId}/games/unignore-all`, { method: 'POST' });
        if (resp.ok) { _gamesPage = 0; await loadUserGamesPage(); await loadUsers(); }
    } catch (e) { console.error('Unignore all error:', e); }
}

// ——— Auto-analysis tab ———

async function loadAutoAnalysis() {
    const tbody = document.querySelector('#auto-analysis-table tbody');
    if (!tbody) return;

    try {
        const settingsResp = await apiFetch('/api/settings');
        if (settingsResp.ok) {
            const settings = await settingsResp.json();
            const toggle = document.getElementById('toggle-auto-analysis-default');
            if (toggle) toggle.checked = settings.auto_analysis_default !== false;
        }

        const resp = await apiFetch('/api/admin/auto-analysis');
        if (!resp.ok) { tbody.innerHTML = `<tr><td colspan="6" class="text-error">${t('admin.loadError')}</td></tr>`; return; }
        const users = await resp.json();

        if (!users.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="opacity-60">${t('admin.noAutoAnalysis')}</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(u => {
            const statusBadge = getStatusBadge(u.status);
            const pct = u.total_games > 0 ? Math.round((u.analysed / u.total_games) * 100) : 0;
            const isPaused = u.status === 'paused';
            return `
                <tr>
                    <td data-label="${t('admin.username')}"><strong>${escapeHtml(u.username)}</strong></td>
                    <td data-label="${t('admin.lichess')}">${u.lichess_username ? escapeHtml(u.lichess_username) : '<span class="opacity-40">--</span>'}</td>
                    <td data-label="${t('admin.autoAnalysisStatus')}">${statusBadge}</td>
                    <td data-label="${t('admin.autoAnalysisProgress')}">
                        <div class="flex items-center gap-2">
                            <span class="opacity-60 text-xs">${u.analysed}/${u.total_games}</span>
                            <progress class="progress progress-primary w-20" value="${pct}" max="100"></progress>
                            <span class="opacity-60 text-xs">${pct}%</span>
                        </div>
                    </td>
                    <td data-label="${t('admin.autoAnalysisCurrentGame')}" class="opacity-50 text-xs">${u.current_game ? escapeHtml(u.current_game) : '--'}</td>
                    <td data-label="${t('admin.actions')}">
                        ${isPaused
                            ? `<button class="btn btn-xs btn-primary btn-resume-analysis" data-uid="${u.user_id}">${t('admin.resumeAnalysis')}</button>`
                            : `<button class="btn btn-xs btn-ghost btn-pause-analysis" data-uid="${u.user_id}">${t('admin.pauseAnalysis')}</button>`
                        }
                    </td>
                </tr>`;
        }).join('');

        tbody.querySelectorAll('.btn-pause-analysis').forEach(btn =>
            btn.addEventListener('click', () => pauseAnalysis(parseInt(btn.dataset.uid))));
        tbody.querySelectorAll('.btn-resume-analysis').forEach(btn =>
            btn.addEventListener('click', () => resumeAnalysis(parseInt(btn.dataset.uid))));
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-error">${t('admin.loadError')}</td></tr>`;
    }
}

function getStatusBadge(status) {
    const map = {
        running:  { cls: 'pill pill-success', key: 'admin.analysisRunning' },
        paused:   { cls: 'pill pill-warning', key: 'admin.analysisPaused' },
        idle:     { cls: 'pill pill-ghost',   key: 'admin.analysisIdle' },
        complete: { cls: 'pill pill-info',    key: 'admin.analysisComplete' },
    };
    const info = map[status] || map.idle;
    return `<span class="${info.cls} pill-xs">${t(info.key)}</span>`;
}

async function toggleAutoAnalysisDefault(e) {
    const enabled = e.target.checked;
    try {
        await apiFetch('/api/settings', {
            method: 'POST', body: { auto_analysis_default: enabled },
        });
    } catch (err) { e.target.checked = !enabled; }
}

async function pauseAnalysis(userId) {
    try { const r = await apiFetch(`/api/admin/auto-analysis/${userId}/pause`, { method: 'POST' }); if (r.ok) await loadAutoAnalysis(); }
    catch (e) { alert(t('admin.networkError')); }
}

async function resumeAnalysis(userId) {
    try { const r = await apiFetch(`/api/admin/auto-analysis/${userId}/resume`, { method: 'POST' }); if (r.ok) await loadAutoAnalysis(); }
    catch (e) { alert(t('admin.networkError')); }
}

async function pauseAllAnalysis() {
    try { const r = await apiFetch('/api/admin/auto-analysis/pause-all', { method: 'POST' }); if (r.ok) await loadAutoAnalysis(); }
    catch (e) { alert(t('admin.networkError')); }
}

async function resumeAllAnalysis() {
    try { const r = await apiFetch('/api/admin/auto-analysis/resume-all', { method: 'POST' }); if (r.ok) await loadAutoAnalysis(); }
    catch (e) { alert(t('admin.networkError')); }
}

// ——— Subscriptions tab ———

async function loadTiers() {
    const tbody = document.querySelector('#admin-tiers-table tbody');
    if (!tbody) return;

    try {
        const resp = await apiFetch('/api/admin/subscription-tiers');
        if (!resp.ok) { tbody.innerHTML = `<tr><td colspan="8" class="text-error">${t('admin.loadError')}</td></tr>`; return; }
        _allTiers = await resp.json();

        if (!_allTiers.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="opacity-60">${t('admin.noTiers')}</td></tr>`;
        } else {
            tbody.innerHTML = _allTiers.map(tier => {
                const price = tier.price_cents === 0 ? t('subscription.freeTier') : `${(tier.price_cents / 100).toFixed(2)} ${(tier.currency || 'eur').toUpperCase()}`;
                const active = tier.is_active !== 0;
                const intervalLabel = tier.interval === 'year' ? t('pricing.annual') : t('pricing.monthly');
                return `
                    <tr>
                        <td data-label="ID" class="opacity-60">${tier.id}</td>
                        <td data-label="${t('admin.tierName')}"><strong>${escapeHtml(tier.name)}</strong></td>
                        <td data-label="Slug" class="opacity-60">${escapeHtml(tier.slug)}</td>
                        <td data-label="${t('admin.tierInterval')}"><span class="badge badge-ghost badge-sm">${intervalLabel}</span></td>
                        <td data-label="${t('admin.tierPrice')}">${price}</td>
                        <td data-label="Stripe" class="opacity-60 text-xs">${tier.stripe_price_id || '--'}</td>
                        <td data-label="${t('admin.status')}">${active ? `<span class="pill pill-success pill-xs">${t('admin.badgeActive')}</span>` : `<span class="pill pill-error pill-xs">${t('admin.badgeDisabled')}</span>`}</td>
                        <td data-label="${t('admin.actions')}">
                            <div class="flex gap-1">
                                <button class="btn btn-xs btn-ghost btn-toggle-tier" data-tid="${tier.id}" data-active="${active ? '1' : '0'}">${active ? t('admin.deactivate') : t('admin.activate')}</button>
                                <button class="btn btn-xs btn-error btn-delete-tier" data-tid="${tier.id}">${t('admin.deleteUser')}</button>
                            </div>
                        </td>
                    </tr>`;
            }).join('');

            tbody.querySelectorAll('.btn-toggle-tier').forEach(btn =>
                btn.addEventListener('click', () => toggleTierActive(parseInt(btn.dataset.tid), btn.dataset.active === '1')));
            tbody.querySelectorAll('.btn-delete-tier').forEach(btn =>
                btn.addEventListener('click', () => deleteTier(parseInt(btn.dataset.tid))));
        }

        loadSubStats();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-error">${t('admin.loadError')}</td></tr>`;
    }
}

async function loadSubStats() {
    const el = document.getElementById('sub-stats-container');
    if (!el) return;
    try {
        const resp = await apiFetch('/api/admin/subscription-stats');
        if (!resp.ok) return;
        const stats = await resp.json();
        const byTierHtml = Object.entries(stats.by_tier || {}).map(([name, cnt]) =>
            `<div class="stat bg-base-200 rounded-box p-4"><div class="stat-title">${escapeHtml(name)}</div><div class="stat-value text-lg">${cnt}</div></div>`
        ).join('');
        el.innerHTML = `
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div class="stat bg-base-200 rounded-box p-4"><div class="stat-title">${t('admin.activeSubscriptions')}</div><div class="stat-value text-lg">${stats.active ?? 0}</div></div>
                <div class="stat bg-base-200 rounded-box p-4"><div class="stat-title">${t('admin.totalSubscriptions')}</div><div class="stat-value text-lg">${stats.total ?? 0}</div></div>
                ${byTierHtml}
            </div>`;
    } catch (e) {}
}

async function loadAnalytics() {
    const container = document.getElementById('analytics-container');
    if (!container) return;

    try {
        const [funnelResp, reasonsResp] = await Promise.all([
            apiFetch('/api/admin/subscription-funnel?days=30&by_referral=true'),
            apiFetch('/api/admin/cancellation-reasons?days=30'),
        ]);

        const funnel = funnelResp.ok ? await funnelResp.json() : {};
        const reasons = reasonsResp.ok ? await reasonsResp.json() : [];

        const started = funnel.checkout_started || 0;
        const completed = funnel.checkout_completed || 0;
        const canceled = funnel.subscription_canceled || 0;
        const convRate = started > 0 ? Math.round(completed / started * 100) : 0;

        let reasonsHtml = '';
        if (reasons.length) {
            reasonsHtml = `
                <h4 class="font-semibold mt-4 mb-2">${t('admin.churnReasons')}</h4>
                <div class="space-y-1">
                    ${reasons.map(r => `
                        <div class="flex justify-between items-center text-sm py-1 border-b border-base-300">
                            <span>${escapeHtml(r.feedback)} <span class="opacity-50">(${r.cnt})</span></span>
                            <span class="text-xs opacity-50 max-w-xs truncate">${escapeHtml(r.reasons || '')}</span>
                        </div>
                    `).join('')}
                </div>`;
        }

        // Referral breakdown
        let referralHtml = '';
        if (funnel.by_source && Object.keys(funnel.by_source).length) {
            referralHtml = `
                <h4 class="font-semibold mt-4 mb-2">${t('admin.referralSource')}</h4>
                <div class="overflow-x-auto">
                <table class="table table-zebra table-sm">
                    <thead><tr><th>Source</th><th>${t('admin.checkoutStarted')}</th><th>${t('admin.checkoutCompleted')}</th><th>${t('subscription.canceled')}</th></tr></thead>
                    <tbody>${Object.entries(funnel.by_source).map(([label, data]) => `
                        <tr>
                            <td><strong>${escapeHtml(label)}</strong></td>
                            <td>${data.checkout_started || 0}</td>
                            <td>${data.checkout_completed || 0}</td>
                            <td>${data.subscription_canceled || 0}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                </div>`;
        }

        container.innerHTML = `
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <div class="stat bg-base-200 rounded-box p-4">
                    <div class="stat-title">${t('admin.checkoutStarted')}</div>
                    <div class="stat-value text-lg">${started}</div>
                </div>
                <div class="stat bg-base-200 rounded-box p-4">
                    <div class="stat-title">${t('admin.checkoutCompleted')}</div>
                    <div class="stat-value text-lg">${completed}</div>
                </div>
                <div class="stat bg-base-200 rounded-box p-4">
                    <div class="stat-title">${t('admin.conversionRate')}</div>
                    <div class="stat-value text-lg">${convRate}%</div>
                </div>
                <div class="stat bg-base-200 rounded-box p-4">
                    <div class="stat-title">${t('subscription.canceled')}</div>
                    <div class="stat-value text-lg">${canceled}</div>
                </div>
            </div>
            ${referralHtml}
            ${reasonsHtml}
        `;
    } catch (e) {
        container.innerHTML = `<div class="text-error text-sm">${t('admin.loadError')}</div>`;
    }
}

function showTierForm() {
    document.getElementById('tier-form-container').style.display = '';
    ['tier-name', 'tier-slug', 'tier-stripe-price'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('tier-price').value = '999';
    const intervalSel = document.getElementById('tier-interval');
    if (intervalSel) intervalSel.value = 'month';
    ['feat-ai-coaching', 'feat-auto-analysis', 'feat-training', 'feat-advanced-stats'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
}

function hideTierForm() { document.getElementById('tier-form-container').style.display = 'none'; }

async function saveTier() {
    const name = document.getElementById('tier-name')?.value.trim();
    const slug = document.getElementById('tier-slug')?.value.trim();
    if (!name || !slug) { alert(t('admin.tierNameSlugRequired')); return; }
    const features = JSON.stringify({
        ai_coaching: document.getElementById('feat-ai-coaching')?.checked || false,
        auto_analysis: document.getElementById('feat-auto-analysis')?.checked || false,
        training: document.getElementById('feat-training')?.checked || false,
        advanced_stats: document.getElementById('feat-advanced-stats')?.checked || false,
    });
    try {
        const resp = await apiFetch('/api/admin/subscription-tiers', {
            method: 'POST',
            body: {
                name, slug,
                price_cents: parseInt(document.getElementById('tier-price')?.value) || 0,
                stripe_price_id: document.getElementById('tier-stripe-price')?.value.trim() || '',
                features_json: features,
                interval: document.getElementById('tier-interval')?.value || 'month',
            },
        });
        if (resp.ok) { hideTierForm(); await loadTiers(); }
        else { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); }
    } catch (e) { alert(t('admin.networkError')); }
}

async function toggleTierActive(tierId, currentlyActive) {
    try {
        const resp = await apiFetch(`/api/admin/subscription-tiers/${tierId}`, {
            method: 'PUT', body: { is_active: !currentlyActive },
        });
        if (resp.ok) await loadTiers();
        else { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); }
    } catch (e) { alert(t('admin.networkError')); }
}

async function deleteTier(tierId) {
    if (!confirm(t('admin.confirmDeleteTier'))) return;
    try {
        const resp = await apiFetch(`/api/admin/subscription-tiers/${tierId}`, { method: 'DELETE' });
        if (resp.ok) await loadTiers();
        else { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); }
    } catch (e) { alert(t('admin.networkError')); }
}

// ——— Promo codes ———

async function loadPromos() {
    const tbody = document.querySelector('#admin-promos-table tbody');
    if (!tbody) return;

    const tierSelect = document.getElementById('promo-tier-select');
    if (tierSelect && _allTiers.length) {
        tierSelect.innerHTML = _allTiers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    }

    try {
        const resp = await apiFetch('/api/admin/promo-codes');
        if (!resp.ok) { tbody.innerHTML = `<tr><td colspan="7" class="text-error">${t('admin.loadError')}</td></tr>`; return; }
        const promos = await resp.json();

        if (!promos.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="opacity-60">${t('admin.noPromos')}</td></tr>`;
            return;
        }

        tbody.innerHTML = promos.map(p => {
            const active = p.is_active !== 0;
            const tierName = _allTiers.find(t => t.id === p.tier_id)?.name || `#${p.tier_id}`;
            return `
                <tr>
                    <td data-label="ID" class="opacity-60">${p.id}</td>
                    <td data-label="${t('admin.promoCode')}"><strong>${escapeHtml(p.code)}</strong></td>
                    <td data-label="${t('admin.promoTier')}">${escapeHtml(tierName)}</td>
                    <td data-label="${t('admin.promoDuration')}">${p.duration_days}j</td>
                    <td data-label="${t('admin.promoUses')}">${p.current_uses}/${p.max_uses}</td>
                    <td data-label="${t('admin.status')}">${active ? `<span class="pill pill-success pill-xs">${t('admin.badgeActive')}</span>` : `<span class="pill pill-error pill-xs">${t('admin.badgeDisabled')}</span>`}</td>
                    <td data-label="${t('admin.actions')}">
                        <div class="flex gap-1">
                            <button class="btn btn-xs btn-ghost btn-toggle-promo" data-pid="${p.id}" data-active="${active ? '1' : '0'}">${active ? t('admin.deactivate') : t('admin.activate')}</button>
                            <button class="btn btn-xs btn-error btn-delete-promo" data-pid="${p.id}">${t('admin.deleteUser')}</button>
                        </div>
                    </td>
                </tr>`;
        }).join('');

        tbody.querySelectorAll('.btn-toggle-promo').forEach(btn =>
            btn.addEventListener('click', () => togglePromoActive(parseInt(btn.dataset.pid), btn.dataset.active === '1')));
        tbody.querySelectorAll('.btn-delete-promo').forEach(btn =>
            btn.addEventListener('click', () => deletePromo(parseInt(btn.dataset.pid))));
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-error">${t('admin.loadError')}</td></tr>`;
    }
}

function showPromoForm() {
    document.getElementById('promo-form-container').style.display = '';
    document.getElementById('promo-code').value = '';
    document.getElementById('promo-duration').value = '30';
    document.getElementById('promo-max-uses').value = '10';
}

function hidePromoForm() { document.getElementById('promo-form-container').style.display = 'none'; }

async function savePromo() {
    const code = document.getElementById('promo-code')?.value.trim();
    const tierId = parseInt(document.getElementById('promo-tier-select')?.value);
    if (!code) { alert(t('admin.codeRequired')); return; }
    if (!tierId) { alert(t('admin.selectTier')); return; }
    try {
        const resp = await apiFetch('/api/admin/promo-codes', {
            method: 'POST',
            body: {
                code, tier_id: tierId,
                duration_days: parseInt(document.getElementById('promo-duration')?.value) || 30,
                max_uses: parseInt(document.getElementById('promo-max-uses')?.value) || 1,
            },
        });
        if (resp.ok) { hidePromoForm(); await loadPromos(); }
        else { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); }
    } catch (e) { alert(t('admin.networkError')); }
}

async function togglePromoActive(promoId, currentlyActive) {
    try {
        const resp = await apiFetch(`/api/admin/promo-codes/${promoId}`, {
            method: 'PUT', body: { is_active: !currentlyActive },
        });
        if (resp.ok) await loadPromos();
        else { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); }
    } catch (e) { alert(t('admin.networkError')); }
}

async function deletePromo(promoId) {
    if (!confirm(t('admin.confirmDeletePromo'))) return;
    try {
        const resp = await apiFetch(`/api/admin/promo-codes/${promoId}`, { method: 'DELETE' });
        if (resp.ok) await loadPromos();
        else { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); }
    } catch (e) { alert(t('admin.networkError')); }
}

// ——— Logs tab (searchable) ———

async function searchLogs() {
    const container = document.getElementById('logs-container');
    if (!container) return;
    container.innerHTML = '<div class="flex justify-center py-4"><span class="loading loading-spinner loading-sm"></span></div>';

    const q = document.getElementById('logs-search-q')?.value.trim() || '';
    const type = document.getElementById('logs-search-type')?.value || '';
    const user = document.getElementById('logs-search-user')?.value.trim() || '';
    const dateFrom = document.getElementById('logs-date-from')?.value || '';
    const dateTo = document.getElementById('logs-date-to')?.value || '';

    if (!q && !type && !user && !dateFrom && !dateTo) {
        container.innerHTML = `<div class="opacity-60 text-sm py-8 text-center">${t('admin.logsEmptyHint')}</div>`;
        return;
    }

    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    if (user) params.set('user', user);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    params.set('limit', _logsPerPage);
    params.set('offset', _logsPage * _logsPerPage);

    try {
        const resp = await apiFetch(`/api/admin/logs?${params}`);
        if (!resp.ok) { container.innerHTML = `<div class="text-error text-sm">${t('admin.loadError')}</div>`; return; }
        const data = await resp.json();
        const logs = data.logs || [];
        const total = data.total || 0;

        if (!logs.length) {
            container.innerHTML = `<div class="opacity-60 text-sm py-8 text-center">${t('admin.logsNoResults')}</div>`;
            return;
        }

        const totalPages = Math.ceil(total / _logsPerPage);
        const typeBadge = (type) => {
            const cls = type === 'game' ? 'badge-info' : type === 'subscription' ? 'badge-warning' : 'badge-primary';
            return `<span class="badge ${cls} badge-sm">${type}</span>`;
        };

        container.innerHTML = `
            <div class="text-sm opacity-60 mb-2">${t('admin.logsTotal')}: ${total}</div>
            <div class="overflow-x-auto"><table class="table table-zebra table-sm admin-responsive-table">
            <thead><tr><th>${t('admin.logType')}</th><th>${t('admin.username')}</th><th>${t('admin.logDetail')}</th><th>${t('admin.date')}</th></tr></thead>
            <tbody>${logs.map(log => `
                <tr>
                    <td data-label="${t('admin.logType')}">${typeBadge(log.type)}</td>
                    <td data-label="${t('admin.username')}"><strong>${escapeHtml(log.user)}</strong></td>
                    <td data-label="${t('admin.logDetail')}" class="text-sm">${escapeHtml(log.detail)}</td>
                    <td data-label="${t('admin.date')}" class="opacity-50 text-xs">${log.date ? formatDate(log.date) : '--'}</td>
                </tr>`).join('')}
            </tbody></table></div>
            <div class="flex justify-center gap-1 mt-3" id="logs-pagination"></div>`;

        // Render pagination
        if (totalPages > 1) {
            const pagDiv = document.getElementById('logs-pagination');
            let html = '';
            html += `<button class="btn btn-ghost btn-xs" ${_logsPage === 0 ? 'disabled' : ''} data-lp="${_logsPage - 1}">&laquo;</button>`;
            const start = Math.max(0, _logsPage - 3);
            const end = Math.min(totalPages, _logsPage + 4);
            for (let i = start; i < end; i++) {
                html += `<button class="btn btn-xs ${i === _logsPage ? 'btn-primary' : 'btn-ghost'}" data-lp="${i}">${i + 1}</button>`;
            }
            html += `<button class="btn btn-ghost btn-xs" ${_logsPage >= totalPages - 1 ? 'disabled' : ''} data-lp="${_logsPage + 1}">&raquo;</button>`;
            pagDiv.innerHTML = html;
            pagDiv.querySelectorAll('.btn:not([disabled])').forEach(btn =>
                btn.addEventListener('click', () => { _logsPage = parseInt(btn.dataset.lp); searchLogs(); }));
        }
    } catch (e) {
        container.innerHTML = `<div class="text-error text-sm">${t('admin.loadError')}</div>`;
    }
}

function clearLogsSearch() {
    ['logs-search-q', 'logs-search-user', 'logs-date-from', 'logs-date-to'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const sel = document.getElementById('logs-search-type');
    if (sel) sel.value = '';
    _logsPage = 0;
    const container = document.getElementById('logs-container');
    if (container) container.innerHTML = `<div class="opacity-60 text-sm py-8 text-center">${t('admin.logsEmptyHint')}</div>`;
}

// ——— Configuration tab ———

async function loadStockfishSettings() {
    try {
        const resp = await apiFetch('/api/settings');
        if (!resp.ok) return;
        const s = await resp.json();
        const el = (id) => document.getElementById(id);
        if (el('stockfish-depth') && s.stockfish_depth) el('stockfish-depth').value = s.stockfish_depth;
        if (el('claude-timeout') && s.claude_timeout) el('claude-timeout').value = s.claude_timeout;
        if (el('claude-post-game-timeout') && s.claude_post_game_timeout) el('claude-post-game-timeout').value = s.claude_post_game_timeout;
    } catch (e) {}

    try {
        const resp = await apiFetch('/api/admin/cheater-detection');
        if (resp.ok) {
            const data = await resp.json();
            const select = document.getElementById('cheater-detection-mode');
            if (select) select.value = data.mode || 'all';
        }
    } catch (e) {}

    // Load referral domain + layout customization toggle
    try {
        const resp = await apiFetch('/api/admin/config');
        if (resp.ok) {
            const cfg = await resp.json();
            const el = document.getElementById('referral-domain');
            if (el && cfg.referral_domain) el.value = cfg.referral_domain;
            const layoutToggle = document.getElementById('layout-customization-toggle');
            if (layoutToggle) layoutToggle.checked = cfg.layout_customization_enabled !== false;
        }
    } catch (e) {}
}

async function saveStockfishSettings() {
    const status = document.getElementById('stockfish-save-status');
    status.textContent = t('admin.saving');
    const data = {};
    const sfDepth = document.getElementById('stockfish-depth')?.value || '';
    if (sfDepth) data.stockfish_depth = parseInt(sfDepth);

    try {
        const resp = await apiFetch('/api/settings', { method: 'POST', body: data });
        if (resp.ok) {
            status.textContent = t('admin.saved');
            status.className = 'text-sm text-success';
            await loadEnrichedStats();
        } else {
            status.textContent = t('admin.saveError');
            status.className = 'text-sm text-error';
        }
    } catch (e) {
        status.textContent = t('admin.networkError');
        status.className = 'text-sm text-error';
    }
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
}

async function saveClaudeConfig() {
    const status = document.getElementById('claude-save-status');
    status.textContent = t('admin.saving');
    const data = {};
    const ct = document.getElementById('claude-timeout')?.value;
    const cpgt = document.getElementById('claude-post-game-timeout')?.value;
    if (ct) data.claude_timeout = parseInt(ct);
    if (cpgt) data.claude_post_game_timeout = parseInt(cpgt);

    try {
        const resp = await apiFetch('/api/admin/config', { method: 'POST', body: data });
        if (resp.ok) {
            status.textContent = t('admin.saved');
            status.className = 'text-sm text-success';
        } else {
            status.textContent = t('admin.saveError');
            status.className = 'text-sm text-error';
        }
    } catch (e) {
        status.textContent = t('admin.networkError');
        status.className = 'text-sm text-error';
    }
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
}

async function saveReferralDomain() {
    const status = document.getElementById('referral-domain-status');
    const domain = document.getElementById('referral-domain')?.value.trim() || '';
    status.textContent = t('admin.saving');

    try {
        const resp = await apiFetch('/api/admin/config', {
            method: 'POST', body: { referral_domain: domain },
        });
        if (resp.ok) {
            status.textContent = t('admin.saved');
            status.className = 'text-sm text-success';
        } else {
            status.textContent = t('admin.saveError');
            status.className = 'text-sm text-error';
        }
    } catch (e) {
        status.textContent = t('admin.networkError');
        status.className = 'text-sm text-error';
    }
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
}

async function onCheaterDetectionChange(e) {
    const mode = e.target.value;
    try {
        await apiFetch('/api/admin/cheater-detection', { method: 'POST', body: { mode } });
    } catch (err) { e.target.value = 'all'; }
}

async function onLayoutCustomizationToggle(e) {
    const enabled = e.target.checked;
    try {
        await apiFetch('/api/admin/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layout_customization_enabled: enabled }),
        });
    } catch (err) { e.target.checked = !enabled; }
}

// ——— Referrals tab ———

let _referralDomain = '';

async function loadReferrals() {
    const tbody = document.querySelector('#admin-referrals-table tbody');
    if (!tbody) return;

    // Fetch domain for building URLs
    try {
        const resp = await apiFetch('/api/admin/config');
        if (resp.ok) {
            const cfg = await resp.json();
            _referralDomain = cfg.referral_domain || '';
        }
    } catch (e) {}
    const baseUrl = _referralDomain || location.origin;

    try {
        const resp = await apiFetch('/api/admin/referrals');
        if (!resp.ok) { tbody.innerHTML = `<tr><td colspan="7" class="text-error">${t('admin.loadError')}</td></tr>`; return; }
        const links = await resp.json();

        if (!links.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="opacity-60">${t('admin.noReferrals')}</td></tr>`;
            return;
        }

        tbody.innerHTML = links.map(link => {
            const active = link.is_active !== 0;
            const url = `${baseUrl}/r/${link.code}`;
            const regs = link.registrations || 0;
            const subs = link.subscriptions || 0;
            const convRate = regs > 0 ? Math.round(subs / regs * 100) : 0;
            return `
                <tr>
                    <td data-label="${t('admin.referralLabel')}"><strong>${escapeHtml(link.label || link.code)}</strong></td>
                    <td data-label="${t('admin.referralLink')}">
                        <div class="referral-url">
                            <input type="text" class="input input-bordered input-xs" style="flex:1;min-width:120px" value="${escapeHtml(url)}" readonly />
                            <button class="btn btn-xs btn-ghost btn-copy-url" data-url="${escapeHtml(url)}" title="${t('admin.referralCopy')}">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                            </button>
                        </div>
                    </td>
                    <td data-label="${t('admin.referralClicks')}">${link.total_clicks || link.clicks || 0}</td>
                    <td data-label="${t('admin.referralRegistrations')}">${regs}</td>
                    <td data-label="${t('admin.referralSubscriptions')}">${subs} ${regs > 0 ? `<span class="opacity-50 text-xs">(${convRate}%)</span>` : ''}</td>
                    <td data-label="${t('admin.status')}">${active ? `<span class="pill pill-success pill-xs">${t('admin.badgeActive')}</span>` : `<span class="pill pill-error pill-xs">${t('admin.badgeDisabled')}</span>`}</td>
                    <td data-label="${t('admin.actions')}">
                        <div class="flex gap-1">
                            <button class="btn btn-xs btn-ghost btn-toggle-referral" data-rid="${link.id}" data-active="${active ? '1' : '0'}">${active ? t('admin.deactivate') : t('admin.activate')}</button>
                            <button class="btn btn-xs btn-error btn-delete-referral" data-rid="${link.id}">${t('admin.deleteUser')}</button>
                        </div>
                    </td>
                </tr>`;
        }).join('');

        // Event binding
        tbody.querySelectorAll('.btn-copy-url').forEach(btn =>
            btn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(btn.dataset.url);
                    btn.textContent = '\u2713';
                    setTimeout(() => { btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>'; }, 1500);
                } catch (e) {}
            }));
        tbody.querySelectorAll('.btn-toggle-referral').forEach(btn =>
            btn.addEventListener('click', () => toggleReferralActive(parseInt(btn.dataset.rid), btn.dataset.active === '1')));
        tbody.querySelectorAll('.btn-delete-referral').forEach(btn =>
            btn.addEventListener('click', () => deleteReferral(parseInt(btn.dataset.rid))));
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-error">${t('admin.loadError')}</td></tr>`;
    }
}

function showReferralForm() {
    document.getElementById('referral-form-container').style.display = '';
    ['referral-label', 'referral-code', 'referral-utm-source', 'referral-utm-medium', 'referral-utm-campaign'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('referral-target').value = '/';
}

function hideReferralForm() { document.getElementById('referral-form-container').style.display = 'none'; }

async function saveReferral() {
    const code = document.getElementById('referral-code')?.value.trim();
    const label = document.getElementById('referral-label')?.value.trim() || '';
    if (!code) { alert(t('admin.codeRequired')); return; }
    try {
        const resp = await apiFetch('/api/admin/referrals', {
            method: 'POST',
            body: {
                code, label,
                target_url: document.getElementById('referral-target')?.value.trim() || '/',
                utm_source: document.getElementById('referral-utm-source')?.value.trim() || '',
                utm_medium: document.getElementById('referral-utm-medium')?.value.trim() || '',
                utm_campaign: document.getElementById('referral-utm-campaign')?.value.trim() || '',
            },
        });
        if (resp.ok) { hideReferralForm(); await loadReferrals(); }
        else { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); }
    } catch (e) { alert(t('admin.networkError')); }
}

async function toggleReferralActive(linkId, currentlyActive) {
    try {
        const resp = await apiFetch(`/api/admin/referrals/${linkId}`, {
            method: 'PUT', body: { is_active: !currentlyActive },
        });
        if (resp.ok) await loadReferrals();
        else { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); }
    } catch (e) { alert(t('admin.networkError')); }
}

async function deleteReferral(linkId) {
    if (!confirm(t('admin.confirmDeleteReferral'))) return;
    try {
        const resp = await apiFetch(`/api/admin/referrals/${linkId}`, { method: 'DELETE' });
        if (resp.ok) await loadReferrals();
        else { const err = await resp.json().catch(() => ({})); alert(err.detail || t('common.error')); }
    } catch (e) { alert(t('admin.networkError')); }
}

// ——— CSV Exports ———

async function downloadExport(type) {
    try {
        const resp = await apiFetch(`/api/admin/export/${type}`);
        if (!resp.ok) { alert(t('admin.loadError')); return; }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chess_learn_${type}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) { alert(t('admin.networkError')); }
}

// ——— Branding (logo, titre, icône PWA) ———

async function loadBranding() {
    try {
        const resp = await apiFetch('/api/admin/branding');
        if (!resp.ok) return;
        const data = await resp.json();
        const nameEl = document.getElementById('branding-site-name');
        const descEl = document.getElementById('branding-site-desc');
        if (nameEl) nameEl.value = data.site_name || '';
        if (descEl) descEl.value = data.site_description || '';
        const logoPreview = document.getElementById('branding-logo-preview');
        if (logoPreview) {
            if (data.logo_url) { logoPreview.src = data.logo_url; logoPreview.style.display = ''; }
            else logoPreview.style.display = 'none';
        }
        const iconPreview = document.getElementById('branding-icon-preview');
        if (iconPreview) {
            if (data.has_custom_icon) { iconPreview.src = '/branding/icon-192.png'; iconPreview.style.display = ''; }
            else iconPreview.style.display = 'none';
        }
    } catch (e) { console.warn('Branding load error:', e); }
}

async function saveBranding() {
    const statusEl = document.getElementById('branding-save-status');
    const btn = document.getElementById('btn-save-branding');
    if (btn) btn.disabled = true;
    if (statusEl) { statusEl.textContent = '...'; statusEl.className = 'text-sm opacity-60'; }

    try {
        const form = new FormData();
        const name = document.getElementById('branding-site-name')?.value?.trim();
        const desc = document.getElementById('branding-site-desc')?.value?.trim();
        if (name !== undefined) form.append('site_name', name);
        if (desc !== undefined) form.append('site_description', desc);

        const logoFile = document.getElementById('branding-logo-file')?.files?.[0];
        if (logoFile) form.append('logo', logoFile);

        const iconFile = document.getElementById('branding-icon-file')?.files?.[0];
        if (iconFile) form.append('pwa_icon', iconFile);

        // CSRF: apiFetch ajoute les headers, mais pour FormData on ne peut pas
        // utiliser Content-Type JSON. On utilise fetch directement avec les headers CSRF.
        const csrfToken = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('csrf_token='))?.split('=')?.[1] || '';
        const resp = await fetch('/api/admin/branding', {
            method: 'POST',
            body: form,
            credentials: 'include',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-Token': csrfToken,
            }
        });

        if (resp.ok) {
            const data = await resp.json();
            if (statusEl) { statusEl.textContent = '✓'; statusEl.className = 'text-sm text-success'; }
            // Rafraîchir les previews
            await loadBranding();
            // Rafraîchir le logo sidebar et le titre sans recharger la page
            const sidebarBrand = document.querySelector('.sidebar-brand-text');
            if (sidebarBrand && name) sidebarBrand.textContent = name;
            const sidebarLogo = document.querySelector('.sidebar-brand img');
            if (sidebarLogo && logoFile) sidebarLogo.src = '/branding/logo?' + Date.now();
        } else {
            const err = await resp.json().catch(() => ({}));
            if (statusEl) { statusEl.textContent = err.detail || 'Erreur'; statusEl.className = 'text-sm text-error'; }
        }
    } catch (e) {
        if (statusEl) { statusEl.textContent = 'Erreur réseau'; statusEl.className = 'text-sm text-error'; }
    }
    if (btn) btn.disabled = false;
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
}

// ——— Utilities ———

function formatDate(dateStr) {
    if (!dateStr) return '--';
    try {
        const locale = getLocale();
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
            + ' ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
