/**
 * API helper — wraps fetch() with CSRF headers for mutations.
 */

function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Wrapper around fetch that automatically adds X-Requested-With and
 * X-CSRF-Token headers for non-GET requests (CSRF defense-in-depth).
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export function apiFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();

    if (method !== 'GET' && method !== 'HEAD') {
        if (!options.headers) {
            options.headers = {};
        }
        // Support both Headers object and plain object
        if (options.headers instanceof Headers) {
            if (!options.headers.has('X-Requested-With')) {
                options.headers.set('X-Requested-With', 'XMLHttpRequest');
            }
            if (!options.headers.has('X-CSRF-Token')) {
                const token = getCsrfToken();
                if (token) {
                    options.headers.set('X-CSRF-Token', token);
                }
            }
        } else {
            if (!options.headers['X-Requested-With']) {
                options.headers['X-Requested-With'] = 'XMLHttpRequest';
            }
            if (!options.headers['X-CSRF-Token']) {
                const token = getCsrfToken();
                if (token) {
                    options.headers['X-CSRF-Token'] = token;
                }
            }
        }
    }

    return fetch(url, options);
}
