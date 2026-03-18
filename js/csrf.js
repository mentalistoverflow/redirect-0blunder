/**
 * CSRF protection module — double-submit cookie pattern.
 *
 * Reads the csrf_token cookie and attaches it as X-CSRF-Token header
 * on every mutating request (POST, PUT, DELETE, PATCH).
 */

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Wrapper around fetch() that automatically adds CSRF token
 * and Content-Type for JSON requests.
 *
 * @param {string} url - The URL to fetch
 * @param {Object} [options={}] - fetch options
 * @returns {Promise<Response>}
 */
export async function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  // Add CSRF token + X-Requested-With on mutating methods
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const token = getCsrfToken();
    if (token) {
      headers.set('X-CSRF-Token', token);
    }
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }

  // Default to JSON content type if body is an object
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    options.body = JSON.stringify(options.body);
  }

  return fetch(url, { ...options, headers, credentials: 'same-origin' });
}
