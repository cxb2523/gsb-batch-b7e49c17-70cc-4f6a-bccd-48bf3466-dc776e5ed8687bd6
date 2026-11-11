import { json } from '@sveltejs/kit';
import { callInference } from '#infrastructure/inference/fastapi-client.js';

/** @param {unknown} error */
function errorStatus(error) { const match = /^FastAPI\s+(\d{3}):/i.exec(error instanceof Error ? error.message : ''); return match ? Number(match[1]) : 502; }
/** @param {unknown} error */
function errorMessage(error) { return (error instanceof Error ? error.message : String(error)).replace(/^FastAPI\s+\d{3}:\s*/i, '') || 'No se pudo enviar la invitación.'; }

export async function POST({ request }) {
  const authorization = request.headers.get('authorization');
  if (!authorization) return json({ error: 'Inicia sesión para continuar.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : '';
  const role = body?.role === 'admin' ? 'admin' : body?.role === 'operator' ? 'operator' : null;
  if (!email || !displayName || !role) return json({ error: 'Correo, nombre y rol son obligatorios.' }, { status: 422 });
  try {
    return json(await callInference('/auth/invitations', { method: 'POST', body: { email, display_name: displayName, role }, authorization }), { status: 201 });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
