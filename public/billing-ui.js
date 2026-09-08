(() => {
  const NAV = document.querySelector('.nav');
  const MAIN = document.querySelector('main.container');
  if (!NAV || !MAIN) return;
  const STORAGE_KEY = 'salaBilling';
  const defaultState = { credits: 0, plan: 'Gratis', totalConsumed: 0, nextRechargeAt: null, freeRechargeCredits: 3 };
  const read = () => { try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { return { ...defaultState }; } };
  const navButton = document.createElement('button');
  navButton.className = 'nav-btn'; navButton.dataset.view = 'planes'; navButton.textContent = 'Planes'; NAV.appendChild(navButton);
  const section = document.createElement('section'); section.id = 'view-planes'; section.className = 'view hidden';
  section.innerHTML = `<div class="section-heading"><div><p class="eyebrow">CUENTA Y MONETIZACIÓN</p><h2>Planes y créditos</h2><p class="muted">Compra créditos cuando necesites producir más vídeos. Los pagos se procesan mediante Stripe.</p></div><div class="billing-balance"><span>Saldo</span><strong id="billingCredits">0 créditos</strong></div></div>
    <div class="panel billing-notice"><strong>Cuenta gratuita</strong><span>Dispones de hasta 3 créditos gratuitos. Se renuevan cada 24 horas. Una generación estándar consume 1 crédito; calidad alta consume 2; los vídeos largos consumen créditos por cada escena.</span></div>
    <div class="cards-grid pricing-grid">
      <article class="template-card pricing-card"><span>🆓</span><h3>Gratis</h3><p>Prueba el servicio antes de pagar.</p><strong>3 créditos</strong><small>Cada 24 horas</small><button class="secondary plan-btn" disabled>Activo</button></article>
      <article class="template-card pricing-card featured-plan"><span>🎬</span><h3>Creador</h3><p>Para producir contenido con frecuencia.</p><strong>4,99 €</strong><small>30 créditos</small><button class="primary plan-btn buy-plan" data-plan="creator">Comprar créditos</button></article>
      <article class="template-card pricing-card"><span>🚀</span><h3>Pro</h3><p>Para producción continua y mayor volumen.</p><strong>14,99 €</strong><small>100 créditos</small><button class="secondary plan-btn buy-plan" data-plan="pro">Comprar créditos</button></article>
    </div>
    <div class="panel billing-rules"><div class="panel-title"><h3>Próxima recarga gratuita</h3><span id="billingRechargeStatus">Consultando…</span></div><p id="billingRechargeCountdown" class="muted">Consultando el servidor…</p><div class="billing-steps"><div><b>1</b><span>Recibes hasta 3 créditos gratis cada 24 horas.</span></div><div><b>2</b><span>5 s estándar usa 1 crédito.</span></div><div><b>3</b><span>5 s en alta usa 2 créditos.</span></div><div><b>4</b><span>Los vídeos largos consumen por escena.</span></div></div></div>
    <div id="billingPurchaseMessage" class="panel hidden" role="status"></div>
    <div class="panel billing-history"><div class="panel-title"><h3>Actividad de créditos</h3><button id="billingRefresh" class="secondary">Actualizar</button></div><div id="billingTransactions" class="muted">Cargando actividad…</div></div>`;
  MAIN.insertBefore(section, document.querySelector('.history-panel'));
  const balance = section.querySelector('#billingCredits');
  const history = section.querySelector('#billingTransactions');
  const rechargeStatus = section.querySelector('#billingRechargeStatus');
  const rechargeCountdown = section.querySelector('#billingRechargeCountdown');
  const purchaseMessage = section.querySelector('#billingPurchaseMessage');
  let countdownTimer;
  const render = () => {
    const state = read();
    balance.textContent = `${state.credits} crédito${state.credits === 1 ? '' : 's'}`;
    clearInterval(countdownTimer);
    if (state.plan !== 'Gratis' || !state.nextRechargeAt) {
      rechargeStatus.textContent = state.plan === 'Gratis' ? 'Pendiente de sincronización' : 'Plan de pago';
      rechargeCountdown.textContent = state.plan === 'Gratis' ? 'Pulsa Actualizar para consultar la próxima recarga.' : 'Las recargas gratuitas no se aplican a este plan.';
      return;
    }
    const updateCountdown = () => {
      const remaining = Math.max(0, Number(state.nextRechargeAt) - Date.now());
      if (remaining <= 0) {
        rechargeStatus.textContent = 'Ahora';
        rechargeCountdown.textContent = 'La recarga está disponible. Pulsa Actualizar para recibir los créditos.';
        return;
      }
      const totalSeconds = Math.floor(remaining / 1000);
      rechargeStatus.textContent = new Date(state.nextRechargeAt).toLocaleString('es-ES');
      rechargeCountdown.textContent = `Faltan ${Math.floor(totalSeconds / 3600)} h ${Math.floor((totalSeconds % 3600) / 60)} min ${totalSeconds % 60} s para la próxima recarga de hasta ${state.freeRechargeCredits || 3} créditos.`;
    };
    updateCountdown(); countdownTimer = setInterval(updateCountdown, 1000);
  };
  const renderTransactions = (items = []) => {
    if (!items.length) { history.textContent = 'Todavía no hay consumos registrados.'; return; }
    history.innerHTML = items.map((item) => {
      const date = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
      const label = item.route === '/api/video/sequence' ? 'Vídeo largo' : 'Generación de vídeo';
      return `<div class="billing-transaction"><span><strong>${label}</strong><small>${date}</small></span><strong>−${item.cost} crédito${item.cost === 1 ? '' : 's'}</strong></div>`;
    }).join('');
  };
  const loadBalance = async () => {
    try {
      const response = await fetch('/api/billing/balance');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el saldo.');
      const current = read();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, credits: Number(data.credits || 0), plan: data.plan || 'Gratis', totalConsumed: Number(data.totalConsumed || 0), nextRechargeAt: data.nextRechargeAt || null, freeRechargeCredits: Number(data.freeRechargeCredits || 3) }));
      render();
    } catch {}
  };
  const loadTransactions = async () => {
    try { const response = await fetch('/api/billing/transactions'); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo cargar la actividad.'); renderTransactions(data.transactions); }
    catch (error) { history.textContent = error.message || 'No se pudo cargar la actividad.'; }
  };
  const refreshAll = async () => { await loadBalance(); await loadTransactions(); };
  const showView = (name) => { document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden')); const target = document.querySelector(`#view-${name}`); if (target) target.classList.remove('hidden'); document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === name)); if (name === 'planes') refreshAll(); };
  const showPurchaseMessage = (text, error = false) => { purchaseMessage.classList.remove('hidden'); purchaseMessage.textContent = text; purchaseMessage.style.borderColor = error ? 'rgba(255,100,120,.45)' : ''; };
  section.querySelectorAll('.buy-plan').forEach((button) => button.addEventListener('click', async () => {
    const plan = button.dataset.plan;
    button.disabled = true; button.textContent = 'Preparando pago…';
    showPurchaseMessage('Preparando el pago seguro…');
    try {
      const response = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar el pago.');
      if (!data.checkoutUrl) throw new Error('Stripe no devolvió la dirección de pago.');
      window.location.href = data.checkoutUrl;
    } catch (error) {
      showPurchaseMessage(error.message || 'No se pudo iniciar el pago.', true);
      button.disabled = false; button.textContent = 'Comprar créditos';
    }
  }));
  navButton.addEventListener('click', () => showView('planes'));
  section.querySelector('#billingRefresh').addEventListener('click', refreshAll);
  render(); window.addEventListener('storage', render); window.addEventListener('sala-billing-updated', render);
})();
