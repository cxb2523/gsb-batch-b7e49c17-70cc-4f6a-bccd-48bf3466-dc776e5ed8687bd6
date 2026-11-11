import { json } from '@sveltejs/kit';
import { callInference } from '#infrastructure/inference/fastapi-client.js';

/** @param {unknown} error */
function errorStatus(error) { const match = /^FastAPI\s+(\d{3}):/i.exec(error instanceof Error ? error.message : ''); return match ? Number(match[1]) : 502; }
/** @param {unknown} error */
function errorMessage(error) { return (error instanceof Error ? error.message : String(error)).replace(/^FastAPI\s+\d{3}:\s*/i, '') || 'No se pudo consultar usuarios.'; }

export async function GET({ request, url }) {
  const authorization = request.headers.get('authorization');
  if (!authorization) return json({ error: 'Inicia sesión para continuar.' }, { status: 401 });
  const query = new URLSearchParams();
  for (const key of ['limit', 'offset', 'role', 'active']) { const value = url.searchParams.get(key); if (value) query.set(key, value); }
  try { return json(await callInference(`/users?${query}`, { authorization })); }
  catch (error) { return json({ error: errorMessage(error) }, { status: errorStatus(error) }); }
}
