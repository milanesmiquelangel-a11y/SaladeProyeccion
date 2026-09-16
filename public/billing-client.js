(() => {
  const BILLING_KEY = 'salaBilling';
  const nativeFetch = window.fetch.bind(window);
  let currentUserId = null;
  const readBilling = () => { try { return JSON.parse(localStorage.getItem(BILLING_KEY) || '{}'); } catch { return {}; } };
  const saveBilling = (patch) => { localStorage.setItem(BILLING_KEY, JSON.stringify({ ...readBilling(), ...patch })); window.dispatchEvent(new Event('sala-billing-updated')); };
  const generationCost = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes('/api/video/generate') && !url.includes('/api/video/sequence')) return 0;
    let body = {}; try { body = JSON.parse(init.body || '{}'); } catch {}
    const multiplier = body.resolution === 'high' ? 2 : 1;
    if (url.includes('/api/video/sequence')) return Math.max(1, Math.ceil(Number(body.duration) / 5 || 1)) * multiplier;
    return multiplier;
  };
  async function waitForAuth() { if (!window.salaAuthReady) return null; try { const user = await window.salaAuthReady; currentUserId = user?.id || null; return user; } catch { return null; } }
  async function preflightGeneration(input, init, cost) {
    if (!cost || !currentUserId) return null;
    try {
      const balanceResponse = await nativeFetch('/api/billing/balance', { credentials:'same-origin' });
      const balance = await balanceResponse.json().catch(() => ({}));
      if (!balanceResponse.ok) return null;
      const credits = Number(balance.credits || 0);
      saveBilling({ credits, plan:balance.plan || 'Gratis', totalConsumed:Number(balance.totalConsumed || 0), nextRechargeAt:balance.nextRechargeAt || null, freeRechargeCredits:Number(balance.freeRechargeCredits || 3) });
      if (credits >= cost) return null;
      const next = balance.nextRechargeAt ? new Date(balance.nextRechargeAt) : null;
      const rechargeText = next && !Number.isNaN(next.getTime()) ? ` Próxima recarga gratuita: ${next.toLocaleString('es-ES')}.` : '';
      const message = `Créditos insuficientes. Esta generación necesita ${cost} crédito${cost === 1 ? '' : 's'} y tienes ${credits}.${rechargeText}`;
      return new Response(JSON.stringify({ error:message, credits, required:cost, nextRechargeAt:balance.nextRechargeAt || null, preflight:true }), { status:402, headers:{'Content-Type':'application/json'} });
    } catch { return null; }
  }
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const sameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
    if (!sameOrigin) return nativeFetch(input, init);
    if (url.includes('/api/auth/')) return nativeFetch(input, { ...init, credentials:'same-origin' });

    // Always copy the visible narration fields into the generation payload here,
    // at the last client layer before the native network request. This avoids
    // losing audioText when another frontend wrapper rebuilds the JSON body.
    if (url.includes('/api/video/generate') || url.includes('/api/video/sequence')) {
      try {
        const body = JSON.parse(init.body || '{}');
        const audioText = String(document.querySelector('#audioText')?.value || '').trim();
        const audioLanguage = String(document.querySelector('#audioLanguage')?.value || 'en').trim() || 'en';
        if (audioText) {
          body.audioText = audioText.slice(0, 4000);
          body.audioLanguage = audioLanguage;
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {}
    }

    await waitForAuth();
    const cost = generationCost(input, init);
    const preflightResponse = await preflightGeneration(input, init, cost);
    if (preflightResponse) return preflightResponse;
    const response = await nativeFetch(input, { ...init, credentials:'same-origin' });
    const credits = response.headers.get('X-Sala-Credits');
    const responseCost = response.headers.get('X-Sala-Cost');
    if (credits !== null) saveBilling({ credits:Number(credits), lastCost:Number(responseCost || 0) });
    else if (response.status === 402) { const data = await response.clone().json().catch(() => ({})); if (data.nextRechargeAt) saveBilling({ nextRechargeAt:data.nextRechargeAt, credits:Number(data.credits || 0) }); }
    return response;
  };
  async function refreshBalance() {
    const user = await waitForAuth(); if (!user) return;
    try {
      const response = await nativeFetch('/api/billing/balance', { credentials:'same-origin' }); if (!response.ok) return;
      const data = await response.json();
      saveBilling({ credits:Number(data.credits || 0), plan:data.plan || 'Gratis', totalConsumed:Number(data.totalConsumed || 0), nextRechargeAt:data.nextRechargeAt || null, freeRechargeCredits:Number(data.freeRechargeCredits || 3) });
    } catch {}
  }
  window.addEventListener('sala-authenticated', refreshBalance);
  refreshBalance();
})();
