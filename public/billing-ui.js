(() => {
  const NAV = document.querySelector('.nav');
  const MAIN = document.querySelector('main.container');
  if (!NAV || !MAIN) return;

  const STORAGE_KEY = 'salaBilling';
  const defaultState = { credits: 0, plan: 'Gratis', totalSpent: 0 };
  const read = () => {
    try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
    catch { return { ...defaultState }; }
  };
  const write = (state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  const navButton = document.createElement('button');
  navButton.className = 'nav-btn';
  navButton.dataset.view = 'planes';
  navButton.textContent = 'Planes';
  NAV.appendChild(navButton);

  const section = document.createElement('section');
  section.id = 'view-planes';
  section.className = 'view hidden';
  section.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">CUENTA Y MONETIZACIÓN</p>
        <h2>Planes y créditos</h2>
        <p class="muted">La aplicación queda preparada para cobrar por generación sin exponer la clave del proveedor.</p>
      </div>
      <div class="billing-balance"><span>Saldo</span><strong id="billingCredits">0 créditos</strong></div>
    </div>

    <div class="panel billing-notice">
      <strong>Arquitectura de monetización preparada</strong>
      <span>Los planes que ves aquí son la interfaz comercial. El cobro real y la acreditación segura se conectarán en el servidor antes de vender créditos.</span>
    </div>

    <div class="cards-grid pricing-grid">
      <article class="template-card pricing-card">
        <span>🆓</span><h3>Gratis</h3><p>Para probar Sala de Proyección y conocer el flujo de generación.</p>
        <strong>0 €</strong><small>Sin pago</small>
        <button class="secondary plan-btn" data-plan="Gratis" data-credits="3" disabled>Próximamente</button>
      </article>
      <article class="template-card pricing-card featured-plan">
        <span>🎬</span><h3>Creador</h3><p>Más créditos para producir vídeos con frecuencia.</p>
        <strong>4,99 €</strong><small>Paquete de créditos</small>
        <button class="primary plan-btn" data-plan="Creador" data-credits="30" disabled>Próximamente</button>
      </article>
      <article class="template-card pricing-card">
        <span>🚀</span><h3>Pro</h3><p>Para usuarios que necesitan producir contenido de forma continua.</p>
        <strong>14,99 €</strong><small>Paquete de créditos</small>
        <button class="secondary plan-btn" data-plan="Pro" data-credits="100" disabled>Próximamente</button>
      </article>
    </div>

    <div class="panel billing-rules">
      <div class="panel-title"><h3>Cómo funcionará el cobro</h3><span>Servidor</span></div>
      <div class="billing-steps">
        <div><b>1</b><span>El usuario compra un paquete.</span></div>
        <div><b>2</b><span>El servidor confirma el pago.</span></div>
        <div><b>3</b><span>Se acreditan los créditos una sola vez.</span></div>
        <div><b>4</b><span>Cada generación descuenta su coste.</span></div>
        <div><b>5</b><span>El historial registra consumo e ingresos.</span></div>
      </div>
    </div>
  `;
  MAIN.insertBefore(section, document.querySelector('.history-panel'));

  const balance = section.querySelector('#billingCredits');
  const render = () => {
    const state = read();
    balance.textContent = `${state.credits} crédito${state.credits === 1 ? '' : 's'}`;
  };

  const showView = (name) => {
    document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
    const target = document.querySelector(`#view-${name}`);
    if (target) target.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  };

  navButton.addEventListener('click', () => showView('planes'));
  section.querySelectorAll('.plan-btn').forEach((button) => {
    button.addEventListener('click', () => {
      // Payment intentionally remains disabled until a real payment provider is connected.
      window.alert('El sistema de pago todavía no está conectado. El plan ya está preparado en la interfaz.');
    });
  });

  render();
  window.addEventListener('storage', render);
})();
