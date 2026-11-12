/**
 * gueattend - Google AdSense & Advertisement Container Loader
 * Reads runtime config from /api/ads/config so Render environment variables
 * control live AdSense units without editing HTML templates.
 */
(function () {
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

    const clientId = /^ca-pub-\d+$/.test(config.clientId || '') ? config.clientId : '';
    if (clientId) {
      loadAdSenseScript(clientId);
    }

    containers.forEach((wrapper) => {
      const placement = wrapper.getAttribute('data-ad-placement') || 'landing';
      const labelEl = wrapper.querySelector('.ads-label');
      if (labelEl) {
        labelEl.textContent = 'Advertisement';
      }

      const body = wrapper.querySelector('.ads-slot-body') || wrapper;
      const rawSlot = (config.slots && config.slots[placement]) || '';
      const slotId = /^\d+$/.test(rawSlot) ? rawSlot : '';

      body.innerHTML = '';
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
