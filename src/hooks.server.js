/** @type {import('@sveltejs/kit/hooks').Handle} */
export const handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  // Protección transversal: no expone permisos del navegador ni permite embeber el panel.
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // Las cámaras, alertas y registros del operador no deben quedar en la caché del navegador.
  if (event.url.pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'no-store, max-age=0');

  return response;
};
