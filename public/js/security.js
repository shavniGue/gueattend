/**
 * Shared Client-Side Security Utilities
 * 1. XSS HTML escaping and URL sanitization
 * 2. Automatic same-origin X-CSRF-Token injection for mutating API fetch calls
 */
(function () {
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(url, fallback = '#') {
    const raw = String(url || '').trim();
    if (!raw) return fallback;
    if (raw.startsWith('/') || /^https?:\/\//i.test(raw)) {
      return raw;
    }
    return fallback;
  }

  function safeCaptchaDataUri(rawUri) {
    const raw = String(rawUri || '').trim();
    if (/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(raw)) {
      return raw;
    }
    return '';
  }

  function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  window.GueSecurity = {
    escapeHtml,
    safeUrl,
    safeCaptchaDataUri,
    getCsrfToken,
  };

  // Automatically attach X-CSRF-Token on same-origin mutating fetch calls
  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const urlStr = typeof input === 'string' ? input : (input && input.url) || '';
    const isSameOrigin = !/^https?:\/\//i.test(urlStr) || urlStr.startsWith(window.location.origin);

    if (isMutating && isSameOrigin) {
      const headers = new Headers((init && init.headers) || {});
      const token = getCsrfToken();
      if (token && !headers.has('X-CSRF-Token')) {
        headers.set('X-CSRF-Token', token);
      }
      init = { ...init, headers };
    }
    return origFetch(input, init);
  };
})();
