import { esES } from '@clerk/localizations/es-ES';

/** @type {Promise<any> | null} */
let clerkPromise = null;

// Paleta SentriX aplicada a los componentes seguros preconstruidos de Clerk.
export const sentriXAppearance = {
  variables: {
    colorPrimary: '#075dad',
    colorForeground: '#082957',
    colorBackground: '#ffffff',
    colorInputBackground: '#f4f8fc',
    colorInputText: '#082957',
    colorDanger: '#b4434e',
    colorSuccess: '#08705f',
    borderRadius: '10px',
    fontFamily: 'Inter, Segoe UI, system-ui, sans-serif'
  }
};

/** @param {string} source @param {Record<string, string>} [attributes] */
function loadScript(source, attributes = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${source}"]`);
    if (existing) { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); return; }
    const script = document.createElement('script');
    script.src = source; script.async = true; script.crossOrigin = 'anonymous';
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    script.onload = () => resolve(undefined); script.onerror = () => reject(new Error('No se pudo cargar Clerk.'));
    document.head.appendChild(script);
  });
}

/** @param {string} publishableKey */
function clerkDomain(publishableKey) {
  try { return atob(publishableKey.split('_')[2]).slice(0, -1); }
  catch { throw new Error('La clave publicable de Clerk no es válida.'); }
}

/**
 * Carga Clerk únicamente en el navegador. La clave publicable puede aparecer
 * en el cliente; las claves secretas nunca se importan en el panel.
 */
export async function getClerk() {
  if (typeof window === 'undefined') return null;
  if (!clerkPromise) {
    clerkPromise = (async () => {
      const response = await fetch('/api/auth/config', { signal: AbortSignal.timeout(10_000) });
      const { publishableKey = '' } = response.ok ? await response.json() : {};
      if (!publishableKey) return null;
      const domain = clerkDomain(publishableKey);
      await loadScript(`https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
      await loadScript(`https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { 'data-clerk-publishable-key': publishableKey });
      const clerk = /** @type {any} */ (window).Clerk;
      if (!clerk) throw new Error('Clerk no se pudo inicializar.');
      await clerk.load({
        localization: esES,
        ui: { ClerkUI: /** @type {any} */ (window).__internal_ClerkUICtor }
      });
      return clerk;
    })().catch((error) => {
      // Un fallo temporal de red o Clerk no debe bloquear los siguientes reintentos.
      clerkPromise = null;
      throw error;
    });
  }
  return clerkPromise;
}

/** @returns {Promise<string | null>} */
export async function getSessionToken() {
  const clerk = await getClerk();
  return clerk?.session ? await clerk.session.getToken() : null;
}

export async function signOutAndRedirect() {
  try {
    const clerk = await getClerk();
    await clerk?.signOut();
  } finally {
    window.location.assign('/sign-in');
  }
}
