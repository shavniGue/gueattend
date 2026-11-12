/**
 * gueattend - Google AdSense & Public Advertisement Container Loader
 * Strictly restricts ad rendering to public informational placements (`landing`, `guide`, `privacy`)
 * and reads runtime configuration from `/api/ads/config`. Never claims AdSense approval.
 */
(function () {
  const ALLOWED_PUBLIC_PLACEMENTS = new Set(['landing', 'guide', 'privacy']);

  function loadAdSenseScript(clientId) {
    if (document.querySelector('script[data-gueattend-adsense="true"]')) return;
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.gueattendAdsense = 'true';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
    document.head.appendChild(script);
  }

  async function initAds() {
    const containers = document.querySelectorAll('[data-ad-placement]');
    if (!containers.length) return;

    let config = { enabled: true, clientId: '', slots: {} };
    try {
      const res = await fetch('/api/ads/config');
      if (res.ok) {
        config = await res.json();
      }
    } catch (err) {
      console.warn('[ads] Could not load ads config:', err.message);
    }

    if (config.enabled === false) {
      containers.forEach((el) => {
        el.style.display = 'none';
      });
      return;
    }

    const clientId = /^ca-pub-\d{10,20}$/.test(config.clientId || '') ? config.clientId : '';
    if (clientId) {
      loadAdSenseScript(clientId);
    }

    containers.forEach((wrapper) => {
      const placement = (wrapper.getAttribute('data-ad-placement') || '').trim().toLowerCase();
      if (!ALLOWED_PUBLIC_PLACEMENTS.has(placement)) {
        wrapper.style.display = 'none';
        return;
      }

      const labelEl = wrapper.querySelector('.ads-label');
      if (labelEl) {
        labelEl.textContent = 'Advertisement';
      }

      const body = wrapper.querySelector('.ads-slot-body') || wrapper;
      const rawSlot = (config.slots && config.slots[placement]) || '';
      const slotId = /^\d+$/.test(rawSlot) ? rawSlot : '';

      body.textContent = '';
      if (clientId && slotId) {
        const ins = document.createElement('ins');
        ins.className = 'adsbygoogle';
        ins.style.display = 'block';
        ins.setAttribute('data-ad-client', clientId);
        ins.setAttribute('data-ad-slot', slotId);
        ins.setAttribute('data-ad-format', 'auto');
        ins.setAttribute('data-full-width-responsive', 'true');
        body.appendChild(ins);
        try {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (err) {
          console.warn('[ads] AdSense push note:', err.message);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAds);
  } else {
    initAds();
  }
})();
