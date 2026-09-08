(() => {
  const KEY = 'salaUserId';
  let id = localStorage.getItem(KEY);
  if (!id || !/^[a-zA-Z0-9_-]{16,80}$/.test(id)) {
    id = crypto.randomUUID().replaceAll('-', '');
    localStorage.setItem(KEY, id);
  }
  window.salaAccountId = id;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const sameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
    if (!sameOrigin) return nativeFetch(input, init);
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Sala-User-Id', id);
    const response = await nativeFetch(input, { ...init, headers });
    const credits = response.headers.get('X-Sala-Credits');
    const cost = response.headers.get('X-Sala-Cost');
    if (credits !== null) {
      const current = (() => { try { return JSON.parse(localStorage.getItem('salaBilling') || '{}'); } catch { return {}; } })();
      localStorage.setItem('salaBilling', JSON.stringify({ ...current, credits: Number(credits), lastCost: Number(cost || 0) }));
      window.dispatchEvent(new Event('sala-billing-updated'));
    }
    return response;
  };

  async function refreshBalance() {
    try {
      const response = await nativeFetch('/api/billing/balance', { headers: { 'X-Sala-User-Id': id } });
      if (!response.ok) return;
      const data = await response.json();
      const current = (() => { try { return JSON.parse(localStorage.getItem('salaBilling') || '{}'); } catch { return {}; } })();
      localStorage.setItem('salaBilling', JSON.stringify({ ...current, credits: Number(data.credits || 0), plan: data.plan || 'Gratis', totalConsumed: Number(data.totalConsumed || 0), nextRechargeAt: data.nextRechargeAt || null, freeRechargeCredits: Number(data.freeRechargeCredits || 3) }));
      window.dispatchEvent(new Event('sala-billing-updated'));
    } catch {}
  }
  refreshBalance();
})();
