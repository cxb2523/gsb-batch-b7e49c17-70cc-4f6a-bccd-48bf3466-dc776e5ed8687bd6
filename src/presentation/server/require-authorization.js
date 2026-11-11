import { json } from '@sveltejs/kit';

/** @param {Request} request */
export function requireAuthorization(request) {
  if (request.headers.get('authorization')) return null;
  return json({ error: 'Inicia sesión para continuar.' }, { status: 401 });
}
