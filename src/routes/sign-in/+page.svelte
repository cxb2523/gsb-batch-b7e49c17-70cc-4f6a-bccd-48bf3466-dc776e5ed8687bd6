<script>
  import { onMount } from 'svelte';
  import { getClerk, sentriXAppearance } from '../../lib/auth/clerk-client.js';

  let host = $state(/** @type {HTMLDivElement | null} */ (null));
  let error = $state('');

  onMount(() => {
    /** @type {any} */ let clerk;
    void (async () => {
      try {
        clerk = await getClerk();
        if (!clerk) {
          error = 'Falta configurar PUBLIC_CLERK_PUBLISHABLE_KEY para habilitar el acceso.';
          return;
        }
        if (clerk.user) {
          window.location.replace('/');
          return;
        }
        clerk.mountSignIn(host, {
          routing: 'hash',
          withSignUp: false,
          forceRedirectUrl: '/',
          appearance: sentriXAppearance
        });
      } catch (reason) {
        error = `No se pudo cargar el inicio de sesión. ${reason instanceof Error ? reason.message : String(reason)}`;
      }
    })();
    return () => { if (clerk && host) clerk.unmountSignIn(host); };
  });
</script>

<svelte:head><title>Ingresar — SentriX</title></svelte:head>

<main class="auth-page">
  <div class="visual-panel" aria-hidden="true"></div>
  <section class="auth-card" aria-label="Inicio de sesión SentriX">
    <img class="form-logo" src="/sentrix-logo.webp" alt="SentriX" width="180" height="100" />
    <p class="intro">Ingresa con tu cuenta para acceder al monitoreo.</p>
    {#if error}<p class="error" role="alert">{error}</p>{:else}<div class="clerk-host" bind:this={host} aria-label="Formulario de inicio de sesión"></div>{/if}
  </section>
</main>

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#061b35;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#082957}.auth-page{min-height:100vh;display:grid;grid-template-columns:minmax(300px,1fr) minmax(420px,600px);align-items:center;gap:clamp(32px,7vw,120px);padding:clamp(32px,7vw,110px);background:url('/sentrix-login-background.webp') center/cover no-repeat}.visual-panel{min-height:1px}.auth-card{position:relative;width:100%;padding:clamp(38px,5vw,62px);border:1px solid #d5e9f7;border-radius:34px;background:linear-gradient(145deg,#ffffff,#f5faff);box-shadow:0 24px 55px #00000052}.auth-card:after{position:absolute;top:-2px;right:-2px;width:112px;height:112px;border-top:5px solid #18c8f3;border-right:5px solid #18c8f3;border-radius:0 34px 0 80px;content:""}.form-logo{display:block;width:180px;height:100px;margin:0 auto 32px;object-fit:contain}.intro{margin:0 0 24px;text-align:center;color:#496986;font-size:17px;line-height:1.45}.error{padding:12px;border:1px solid #e8c5c7;border-radius:8px;background:#fff4f4;color:#a34249}.clerk-host{position:relative;z-index:1;margin-top:8px}:global(.cl-rootBox),:global(.cl-cardBox),:global(.cl-card){width:100%!important}:global(.cl-card){box-shadow:none!important;border:0!important;padding:18px!important;background:transparent!important}:global(.cl-header){display:none!important}:global(.cl-formButtonPrimary){background:linear-gradient(90deg,#087ddb,#093b9c)!important;box-shadow:0 7px 16px #075dad3b!important;font-size:16px!important}:global(.cl-formFieldLabel){color:#082957!important;font-weight:700!important}:global(.cl-formFieldInput){border-color:#bfd2e6!important;background:#f6faff!important;border-radius:12px!important}:global(.cl-footerActionLink){color:#075dad!important}:global(.cl-footerItem),:global(.cl-footerItem *){color:#082957!important;background-color:transparent!important}@media(max-width:850px){.auth-page{display:grid;grid-template-columns:1fr;grid-template-rows:210px auto;align-items:start;gap:0;min-height:100vh;padding:0 20px 28px;background:#061b35}.visual-panel{display:block;margin:0 -20px;background:url('/sentrix-login-background.webp') center 34%/cover no-repeat}.auth-card{max-width:550px;margin:-26px auto 0;z-index:1}}@media(max-width:480px){.auth-page{grid-template-rows:156px auto;padding:0 16px 24px}.visual-panel{margin:0 -16px;background-position:center 30%}.auth-card{padding:30px 24px;margin-top:-20px;border-radius:24px}.form-logo{width:132px;height:82px;margin-bottom:16px}.intro{font-size:15px}}
</style>
