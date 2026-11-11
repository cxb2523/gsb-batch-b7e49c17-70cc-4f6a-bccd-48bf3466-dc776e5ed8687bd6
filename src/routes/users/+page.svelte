<script>
  import { onMount } from 'svelte';
  import { getClerk, getSessionToken, signOutAndRedirect } from '../../lib/auth/clerk-client.js';

  /** @typedef {{ id: string, email: string, display_name?: string, role: 'admin' | 'operator', is_active: boolean }} User */
  /** @type {User | null} */ let profile = $state(null);
  /** @type {User[]} */ let users = $state([]);
  let loading = $state(true);
  let error = $state('');
  let notice = $state('');
  let email = $state('');
  let displayName = $state('');
  let role = $state('operator');
  let sending = $state(false);

  /** @param {string} path @param {RequestInit} [options] */
  async function api(path, options = {}) {
    const token = await getSessionToken();
    const headers = new Headers(options.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.assign('/sign-in'); throw new Error('Tu sesión expiró.'); }
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  async function loadUsers() {
    const data = await api('/api/users?limit=20&offset=0');
    users = data.items ?? [];
  }
  /** @param {SubmitEvent} event */
  async function invite(event) {
    event.preventDefault(); error = ''; notice = ''; sending = true;
    try {
      await api('/api/auth/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, display_name: displayName, role }) });
      notice = `Invitación enviada a ${email}.`;
      email = ''; displayName = ''; role = 'operator';
      await loadUsers();
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
    finally { sending = false; }
  }
  onMount(() => {
    void (async () => {
      try {
        const clerk = await getClerk();
        if (!clerk?.user) { window.location.replace('/sign-in'); return; }
        const currentProfile = /** @type {User} */ (await api('/api/auth/me'));
        profile = currentProfile;
        if (currentProfile.role !== 'admin') { error = 'Acceso denegado: esta sección es solo para administradores.'; return; }
        await loadUsers();
      } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
      finally { loading = false; }
    })();
  });
</script>

<svelte:head><title>Usuarios — SentriX</title></svelte:head>
<main class="page">
  <header class="topbar"><a class="back-link" href="/"><span aria-hidden="true">←</span> Volver al panel</a><button class="sign-out" type="button" onclick={signOutAndRedirect}>Cerrar sesión</button></header>
  <section class="hero"><span class="eyebrow">ADMINISTRACIÓN</span><h1>Usuarios e invitaciones</h1><p class="subtitle">Gestiona quién puede acceder al panel de vigilancia SentriX.</p></section>
  {#if error}<p class="message error" role="alert">{error}</p>{/if}
  {#if notice}<p class="message success" role="status">{notice}</p>{/if}
  {#if profile?.role === 'admin'}
    <section class="card invite-card"><div class="section-heading"><div><span class="section-icon" aria-hidden="true">✉</span><h2>Invitar usuario</h2></div><p>Se enviará un enlace seguro para activar la cuenta.</p></div><form onsubmit={invite}><label>Correo electrónico<input type="email" required bind:value={email} placeholder="operador@sentrix.pe" /></label><label>Nombre visible<input required maxlength="100" bind:value={displayName} placeholder="Nombre del operador" /></label><label>Rol<select bind:value={role}><option value="operator">Operador</option><option value="admin">Administrador</option></select></label><button class="invite-button" disabled={sending}>{sending ? 'Enviando…' : 'Enviar invitación →'}</button></form></section>
    <section class="card users-card"><div class="section-heading"><div><span class="section-icon" aria-hidden="true">◉</span><h2>Usuarios registrados</h2></div><span class="count-badge">{users.length} {users.length === 1 ? 'usuario' : 'usuarios'}</span></div>{#if loading}<p class="empty-state">Cargando usuarios…</p>{:else if !users.length}<p class="empty-state">No hay usuarios para mostrar.</p>{:else}<div class="table"><table><thead><tr><th>Usuario</th><th>Correo electrónico</th><th>Rol</th><th>Estado</th></tr></thead><tbody>{#each users as user (user.id)}<tr><td data-label="Usuario"><strong>{user.display_name ?? 'Sin nombre'}</strong></td><td data-label="Correo electrónico">{user.email}</td><td data-label="Rol"><span class:admin={user.role === 'admin'} class="role-badge">{user.role === 'admin' ? 'Administrador' : 'Operador'}</span></td><td data-label="Estado"><span class:inactive={!user.is_active} class="status-badge"><i></i>{user.is_active ? 'Activo' : 'Inactivo'}</span></td></tr>{/each}</tbody></table></div>{/if}</section>
  {/if}
</main>

<style>:global(*){box-sizing:border-box}:global(body){margin:0;background:linear-gradient(135deg,#f2f7fc,#f7fbff);color:#082957;font-family:Inter,"Segoe UI",system-ui,sans-serif}.page{max-width:1180px;margin:auto;padding:28px 32px 80px}.topbar{display:flex;justify-content:space-between;align-items:center}.back-link{display:inline-flex;gap:8px;align-items:center;color:#0969b5;font-weight:750;text-decoration:none}.back-link:hover{text-decoration:underline}.sign-out,.invite-button{border:0;border-radius:9px;background:linear-gradient(110deg,#0878d1,#064b9a);box-shadow:0 7px 16px #075dad24;color:#fff;padding:11px 17px;font:inherit;font-weight:750;cursor:pointer}.sign-out:hover,.invite-button:hover{filter:brightness(1.07)}button:disabled{cursor:not-allowed;opacity:.62}.hero{margin:44px 0 28px}.eyebrow{color:#0978b9;font-size:11px;font-weight:850;letter-spacing:1.5px}h1{margin:8px 0;font-size:clamp(30px,4vw,40px);letter-spacing:-1.1px}.subtitle{max-width:590px;margin:0;color:#59728d;font-size:16px;line-height:1.55}.card{margin-top:20px;padding:26px;border:1px solid #d7e4f0;border-radius:18px;background:#fff;box-shadow:0 12px 28px #062b5510}.section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:22px}.section-heading>div{display:flex;align-items:center;gap:11px}.section-heading h2{margin:0;font-size:20px;letter-spacing:-.3px}.section-heading p{margin:5px 0 0;color:#6c849d;font-size:13px}.section-icon{display:grid;width:35px;height:35px;place-items:center;border-radius:10px;background:#e4f6fb;color:#0788b5;font-weight:900}.count-badge{border-radius:999px;background:#eaf3fb;color:#27618e;padding:7px 11px;font-size:12px;font-weight:750}form{display:grid;grid-template-columns:1.2fr 1.2fr .72fr auto;gap:14px;align-items:end}label{display:grid;gap:7px;color:#244767;font-size:12px;font-weight:800}input,select{min-height:44px;border:1px solid #bfd3e5;border-radius:9px;background:#f9fcff;color:#082957;padding:10px 12px;font:inherit;outline:none}input:focus,select:focus{border-color:#078bcc;box-shadow:0 0 0 3px #11bfea20}.invite-button{min-height:44px;white-space:nowrap}.users-card{padding-bottom:12px}.table{overflow-x:auto}table{width:100%;border-collapse:separate;border-spacing:0;text-align:left}th{background:linear-gradient(90deg,#082d5b,#0d5a96);color:#fff;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}th:first-child{border-radius:10px 0 0 10px}th:last-child{border-radius:0 10px 10px 0}th,td{padding:15px 14px;border-bottom:1px solid #e7eff6}tbody tr:hover{background:#f6fbff}td{color:#294f72;font-size:14px}td strong{color:#082957}.role-badge,.status-badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 10px;background:#eaf4fb;color:#20618e;font-size:12px;font-weight:750}.role-badge.admin{background:#e8edff;color:#4055aa}.status-badge{background:#e8f8f2;color:#08705f}.status-badge i{width:7px;height:7px;border-radius:50%;background:currentColor}.status-badge.inactive{background:#fff1ee;color:#af5245}.message{margin:20px 0 0;padding:13px 15px;border-radius:10px}.error{border:1px solid #f1cccc;background:#fff3f3;color:#9d3540}.success{border:1px solid #c9e9da;background:#eaf9f2;color:#186a4f}.empty-state{margin:0;padding:26px;border-radius:10px;background:#f7fbfe;color:#64819a;text-align:center}@media(max-width:840px){form{grid-template-columns:1fr 1fr}.invite-button{grid-column:span 2}.page{padding:24px 20px 60px}}@media(max-width:560px){.page{padding:20px 14px 48px}.hero{margin:34px 0 22px}.card{padding:19px 15px;border-radius:14px}.section-heading{align-items:center}.section-heading p{display:none}form{grid-template-columns:1fr}.invite-button{grid-column:auto}.count-badge{font-size:11px}.table{overflow:visible}table,tbody,tr,td{display:block}thead{display:none}tbody{display:grid;gap:12px}tr{border:1px solid #dbe8f3;border-radius:12px;padding:7px 13px;background:#fff;box-shadow:0 4px 12px #062b5508}td{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border:0;text-align:right}td:before{color:#65819a;content:attr(data-label);font-size:11px;font-weight:800;text-align:left}.topbar{gap:12px}.sign-out{padding:10px 12px;font-size:13px}}</style>
