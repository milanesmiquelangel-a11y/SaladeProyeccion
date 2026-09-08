(() => {
  const NAV = document.querySelector('.nav');
  const MAIN = document.querySelector('main.container');
  if (!NAV || !MAIN) return;
  const STORAGE_KEY = 'salaBilling';
  const defaultState = { credits: 0, plan: 'Gratis', totalConsumed: 0 };
  const read = () => { try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { return { ...defaultState }; } };
  const navButton = document.createElement('button');
  navButton.className = 'nav-btn'; navButton.dataset.view = 'planes'; navButton.textContent = 'Planes'; NAV.appendChild(navButton);
  const section = document.createElement('section'); section.id = 'view-planes'; section.className = 'view hidden';
  section.innerHTML = `<div class="section-heading"><div><p class="eyebrow">CUENTA Y MONETIZACIÓN</p><h2>Planes y créditos</h2><p class="muted">Tu saldo se controla en el servidor. Los pagos reales se conectarán después.</p></div><div class="billing-balance"><span>Saldo</span><strong id="billingCredits">0 créditos</strong></div></div>
    <div class="panel billing-notice"><strong>Cuenta gratuita</strong><span>Dispones de 3 créditos iniciales. Una generación estándar consume 1 crédito; una generación en calidad alta consume 2. Los vídeos largos consumen créditos por cada escena.</span></div>
    <div class="cards-grid pricing-grid"><article class="template-card pricing-card"><span>🆓</span><h3>Gratis</h3><p>Prueba el servicio antes de pagar.</p><strong>3 créditos</strong><small>Iniciales</small><button class="secondary plan-btn" disabled>Activo</button></article><article class="template-card pricing-card featured-plan"><span>🎬</span><h3>Creador</h3><p>Paquete pensado para producir contenido con frecuencia.</p><strong>4,99 €</strong><small>30 créditos</small><button class="primary plan-btn" disabled>Próximamente</button></article><article class="template-card pricing-card"><span>🚀</span><h3>Pro</h3><p>Para producción continua y mayor volumen.</p><strong>14,99 €</strong><small>100 créditos</small><button class="secondary plan-btn" disabled>Próximamente</button></article></div>
    <div class="panel billing-rules"><div class="panel-title"><h3>Flujo de monetización</h3><span>Servidor</span></div><div class="billing-steps"><div><b>1</b><span>Comprar créditos.</span></div><div><b>2</b><span>Confirmar pago.</span></div><div><b>3</b><span>Acreditar una sola vez.</span></div><div><b>4</b><span>Descontar cada generación.</span></div><div><b>5</b><span>Registrar consumo e ingresos.</span></div></div></div>
    <div class="panel billing-history"><div class="panel-title"><h3>Actividad de créditos</h3><button id="billingRefresh" class="secondary">Actualizar</button></div><div id="billingTransactions" class="muted">Cargando actividad…</div></div>`;
  MAIN.insertBefore(section, document.querySelector('.history-panel'));
  const balance = section.querySelector('#billingCredits');
  const history = section.querySelector('#billingTransactions');
  const render = () => { const state = read(); balance.textContent = `${state.credits} crédito${state.credits === 1 ? '' : 's'}`; };
  const renderTransactions = (items = []) => {
    if (!items.length) { history.textContent = 'Todavía no hay consumos registrados.'; return; }
    history.innerHTML = items.map((item) => {
      const date = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
      const label = item.route === '/api/video/sequence' ? 'Vídeo largo' : 'Generación de vídeo';
      return `<div class="billing-transaction"><span><strong>${label}</strong><small>${date}</small></span><strong>−${item.cost} crédito${item.cost === 1 ? '' : 's'}</strong></div>`;
    }).join('');
  };
  const loadTransactions = async () => {
    try { const response = await fetch('/api/billing/transactions'); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo cargar la actividad.'); renderTransactions(data.transactions); }
    catch (error) { history.textContent = error.message || 'No se pudo cargar la actividad.'; }
  };
  const showView = (name) => { document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden')); const target = document.querySelector(`#view-${name}`); if (target) target.classList.remove('hidden'); document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === name)); if (name === 'planes') loadTransactions(); };
  navButton.addEventListener('click', () => showView('planes'));
  section.querySelector('#billingRefresh').addEventListener('click', loadTransactions);
  render(); window.addEventListener('storage', render); window.addEventListener('sala-billing-updated', render);
})();
