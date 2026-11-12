/** Addresses are compared without regard to case or surrounding spaces. */
export function isSameEmail(first: string, second: string): boolean {
  return first.trim().toLowerCase() === second.trim().toLowerCase();
}

/**
 * Shows enough of an address for its owner to recognise it, `q***@gmail.com`, without giving the
 * whole address to anyone who happens to hold a link.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at < 1) return '***';
  return `${trimmed.charAt(0)}***${trimmed.slice(at)}`;
}
