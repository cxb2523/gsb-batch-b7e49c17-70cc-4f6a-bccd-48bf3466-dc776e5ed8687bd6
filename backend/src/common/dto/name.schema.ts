import { z } from 'zod';

/**
 * What a name may contain. One rule per kind of name, used by every route that accepts one, so a
 * workspace, a project, a canvas and a person are checked the same way wherever they are named.
 * The browser checks the same rule before it sends (frontend `lib/names.ts`); the two are kept
 * in step by their tests, since the projects share no code.
 */
export const NAME_MAX_LENGTH = 100;

/** Letters and numbers of any language, spaces, and . , & ( ) _ ' (straight or curly). */
const THING_NAME = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,&()_'’]*$/u;

/** A person's name: starts with a letter; then letters, numbers, spaces and . ' (straight or curly) - */
const PERSON_NAME = /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .'’-]*$/u;

function nameSchema(label: string, pattern: RegExp, rule: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(NAME_MAX_LENGTH, `${label} cannot exceed ${NAME_MAX_LENGTH} characters`)
    .regex(pattern, `${label} ${rule}`);
}

/** A workspace, project or canvas name. `label` starts the message, e.g. "Project name". */
export const thingName = (label: string) =>
  nameSchema(
    label,
    THING_NAME,
    "can only use letters, numbers, spaces and . , & ( ) _ ', and must start with a letter or number",
  );

export const personName = (label: string) =>
  nameSchema(
    label,
    PERSON_NAME,
    "can only use letters, numbers, spaces and . ' -, and must start with a letter",
  );
