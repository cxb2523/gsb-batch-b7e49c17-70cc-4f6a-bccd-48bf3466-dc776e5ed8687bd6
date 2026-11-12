import { z } from 'zod';

/**
 * What a name may contain, checked before anything is sent. The server applies the same rule
 * (backend `common/dto/name.schema.ts`) and the two are kept in step by their tests, since the
 * projects share no code. A workspace, project and canvas use one rule; a person's name another.
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

/** What is wrong with `value` as a name, in words for the person typing it, or null when it is fine. */
export function nameProblem(schema: z.ZodType<string>, value: string): string | null {
  const result = schema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? 'That name is not allowed.');
}
