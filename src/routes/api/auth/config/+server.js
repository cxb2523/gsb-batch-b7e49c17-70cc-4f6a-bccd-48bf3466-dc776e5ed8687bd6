import { json } from '@sveltejs/kit';
import { PUBLIC_CLERK_PUBLISHABLE_KEY } from '$app/env/private';

// Solo expone la clave publicable de Clerk; la clave secreta nunca llega al navegador.
export function GET() {
  return json({ publishableKey: String(PUBLIC_CLERK_PUBLISHABLE_KEY ?? '') });
}
