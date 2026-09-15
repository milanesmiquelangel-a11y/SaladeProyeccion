(() => {
  const style = document.createElement('style');
  style.textContent = `
    body.auth-locked > .topbar, body.auth-locked > .container, body.auth-locked > footer { display:none !important; }
    #authGate { min-height:100vh; display:grid; place-items:center; padding:24px; box-sizing:border-box; background:radial-gradient(circle at top, #17213d 0, #070b16 55%); color:#f5f7ff; font-family:inherit; }
    .auth-card { width:min(430px,100%); background:rgba(17,24,45,.96); border:1px solid rgba(255,255,255,.12); border-radius:22px; padding:30px; box-shadow:0 24px 80px rgba(0,0,0,.4); }
    .auth-brand { display:flex; align-items:center; gap:12px; margin-bottom:24px; }
    .auth-mark { width:48px; height:48px; display:grid; place-items:center; border-radius:14px; background:#1f6feb; font-size:22px; }
    .auth-brand strong { display:block; font-size:20px; } .auth-brand span { color:#9aa6c2; font-size:13px; }
    .auth-card h2 { margin:0 0 8px; font-size:28px; } .auth-card .auth-sub { margin:0 0 22px; color:#aeb8cf; }
    .auth-tabs { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:20px; }
    .auth-tab { border:1px solid rgba(255,255,255,.12); background:#0e1529; color:#b9c2d8; padding:11px; border-radius:10px; cursor:pointer; font-weight:600; }
    .auth-tab.active { background:#1f6feb; color:white; border-color:#1f6feb; }
    .auth-field { display:block; margin:14px 0; } .auth-field span { display:block; margin-bottom:7px; font-size:13px; color:#c7cee0; }
    .auth-field input { width:100%; box-sizing:border-box; padding:13px 14px; border-radius:10px; border:1px solid #33405e; background:#0a1020; color:white; outline:none; }
    .auth-field input:focus { border-color:#5d9cff; }
    #authSubmit { width:100%; margin-top:8px; padding:13px; border:0; border-radius:10px; background:#1f6feb; color:white; font-weight:700; cursor:pointer; }
    #authSubmit:disabled { opacity:.65; cursor:wait; }
    #authError { min-height:20px; margin-top:13px; color:#ff9b9b; font-size:13px; }
    .auth-note { margin-top:18px; color:#8f9bb5; font-size:12px; line-height:1.5; }
  `;
  document.head.appendChild(style);
  document.body.classList.add('auth-locked');

  const gate = document.createElement('section');
  gate.id = 'authGate';
  gate.innerHTML = `<div class="auth-card"><div class="auth-brand"><div class="auth-mark">▶</div><div><strong>Sala de Proyección</strong><span>AI video studio</span></div></div><div class="auth-tabs"><button type="button" class="auth-tab active" data-auth-mode="login">Iniciar sesión</button><button type="button" class="auth-tab" data-auth-mode="register">Registrarse</button></div><h2 id="authTitle">Welcome back</h2><p class="auth-sub" id="authSubtitle">Sign in to enter the studio and access your credits.</p><form id="authForm"><label class="auth-field"><span>Email</span><input id="authEmail" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label><label class="auth-field"><span>Password</span><input id="authPassword" type="password" autocomplete="current-password" required minlength="8" maxlength="200" placeholder="Minimum 8 characters"></label><label class="auth-field" id="authConfirmField" hidden><span>Confirm password</span><input id="authConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="200"></label><button id="authSubmit" type="submit">Enter studio</button><div id="authError" role="alert"></div></form><div class="auth-note">Your account is required before entering the studio. Free accounts receive up to 3 credits, restored to 3 every 24 hours.</div></div>`;
  document.body.prepend(gate);

  let mode = 'login';
  let resolveReady;
  window.salaAuthReady = new Promise((resolve) => { resolveReady = resolve; });
  const $ = (id) => document.getElementById(id);

  const setMode = (next) => {
    mode = next;
    document.querySelectorAll('.auth-tab').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
    $('authTitle').textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
    $('authSubtitle').textContent = mode === 'login' ? 'Sign in to enter the studio and access your credits.' : 'Create an account to enter the studio and receive your free credits.';
    $('authSubmit').textContent = mode === 'login' ? 'Enter studio' : 'Create account';
    $('authConfirmField').hidden = mode !== 'register';
    $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('authError').textContent = '';
  };
  document.querySelectorAll('.auth-tab').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.authMode)));

  function enterStudio(user) {
    window.salaAccountId = user.id;
    window.salaCurrentUser = user;
    document.body.classList.remove('auth-locked');
    gate.remove();
    resolveReady(user);
    window.dispatchEvent(new CustomEvent('sala-authenticated', { detail: user }));
  }

  async function checkSession() {
    try {
      const response = await fetch('/api/auth/me', { credentials:'same-origin', cache:'no-store' });
      if (response.ok) { const data = await response.json(); if (data.authenticated && data.user) return enterStudio(data.user); }
    } catch {}
    resolveReady(null);
  }

  $('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    const confirm = $('authConfirm').value;
    if (mode === 'register' && password !== confirm) { $('authError').textContent = 'Las contraseñas no coinciden.'; return; }
    $('authSubmit').disabled = true; $('authError').textContent = '';
    try {
      const response = await fetch(`/api/auth/${mode}`, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo completar la autenticación.');
      enterStudio(data.user);
    } catch (error) { $('authError').textContent = error.message; }
    finally { $('authSubmit').disabled = false; }
  });

  window.salaLogout = async () => { try { await fetch('/api/auth/logout', { method:'POST', credentials:'same-origin' }); } catch {} window.location.reload(); };
  checkSession();
})();
