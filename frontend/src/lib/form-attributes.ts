/**
 * Spread onto an input that holds a name or a title, so browsers and password managers do not offer
 * to fill or save it as a login. `autoComplete="off"` alone is ignored by the major password
 * managers, which have their own opt-out attributes (1Password, LastPass, Bitwarden, Dashlane).
 */
export const NOT_A_CREDENTIAL = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;
