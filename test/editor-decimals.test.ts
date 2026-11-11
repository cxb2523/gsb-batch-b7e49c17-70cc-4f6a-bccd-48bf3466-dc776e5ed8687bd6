import { describe, expect, it } from 'vitest';
import { displaySchema, entityTextSchema } from '../src/editor/schemas';

type Field = { name?: string; schema?: Field[]; selector?: { number?: { min: number; max: number } } };

const find = (schema: Field[], name: string): Field | undefined => {
  for (const f of schema) {
    if (f.name === name) return f;
    const inner = f.schema && find(f.schema, name);
    if (inner) return inner;
  }
  return undefined;
};

describe('editor decimals', () => {
  it('offers the same 0–20 range the card accepts, card-wide and per entity', () => {
    for (const schema of [displaySchema(), entityTextSchema()] as Field[][]) {
      expect(find(schema, 'decimals')?.selector?.number).toMatchObject({ min: 0, max: 20 });
    }
  });
});
