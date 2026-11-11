import { json } from '@sveltejs/kit';
import { callInference } from '#infrastructure/inference/fastapi-client.js';

/** @param {unknown} error */
function errorStatus(error) { const match = /^FastAPI\s+(\d{3}):/i.exec(error instanceof Error ? error.message : ''); return match ? Number(match[1]) : 502; }
export async function PATCH({ request, params }) {
  const authorization = request.headers.get('authorization');
  const body = await request.json().catch(() => null);
  if (!authorization) return json({ error: 'Inicia sesión para continuar.' }, { status: 401 });
  if (typeof body?.is_active !== 'boolean') return json({ error: 'is_active debe ser booleano.' }, { status: 422 });
  try { return json(await callInference(`/users/${encodeURIComponent(params.id)}/status`, { method: 'PATCH', body: { is_active: body.is_active }, authorization })); }
  catch (error) { return json({ error: (error instanceof Error ? error.message : String(error)).replace(/^FastAPI\s+\d{3}:\s*/i, '') }, { status: errorStatus(error) }); }
}
