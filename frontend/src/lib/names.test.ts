import { describe, it, expect } from 'vitest';
import { nameProblem, personName, thingName } from './names';

/**
 * The same table as the server's (`backend/test/names.spec.ts`). The projects share no code, so
 * these two lists are how the browser and the server are kept in step: change one, change both.
 */
const THING_NAME_CASES: Array<[string, boolean]> = [
  ['Acme', true],
  ['Q3 Roadmap 2026', true],
  ['R&D (internal)', true],
  ["Alice's Team", true],
  ['Alice’s Team', true],
  ['Acme Inc.', true],
  ['Ops, Dev & QA', true],
  ['snake_case_name', true],
  ['Café Münch', true],
  ['プロジェクト', true],
  ['Проект', true],
  ['2026', true],
  ['a;b', false],
  ['Project-X', false],
  ['a;', false],
  ['Name: Draft', false],
  ['a/b', false],
  ['a\\b', false],
  ['<script>', false],
  ['a"b', false],
  ['50% done', false],
  ['#1', false],
  ['hello!', false],
  ['what?', false],
  ['a@b', false],
  ['a\tb', false],
  ['a\nb', false],
  ['a b', false],
  ['a​b', false],
  ['😀 party', false],
  ['(first)', false],
  ['_hidden', false],
  ['.dotfile', false],
  ['', false],
  ['   ', false],
];

const PERSON_NAME_CASES: Array<[string, boolean]> = [
  ['Syed Qarib', true],
  ["Conan O'Brien", true],
  ['Mary-Jane Watson', true],
  ['Dr. Who', true],
  ['José Ángel', true],
  ['李雷', true],
  ['a;b', false],
  ['Name 2', true],
  ['1Name', false],
  ['A_B', false],
  ['<b>x</b>', false],
  ['-leading', false],
  ['😀', false],
  ['', false],
];

describe('names', () => {
  it.each(THING_NAME_CASES)(
    'a workspace, project or canvas name %j is accepted: %s',
    (value, ok) => {
      expect(thingName('Name').safeParse(value).success).toBe(ok);
    },
  );

  it.each(PERSON_NAME_CASES)('a person name %j is accepted: %s', (value, ok) => {
    expect(personName('Name').safeParse(value).success).toBe(ok);
  });

  it('trims surrounding spaces and refuses more than 100 characters', () => {
    expect(thingName('Name').parse('  Acme  ')).toBe('Acme');
    expect(thingName('Name').safeParse('a'.repeat(100)).success).toBe(true);
    expect(thingName('Name').safeParse('a'.repeat(101)).success).toBe(false);
  });

  it('says what to change, in the name of the thing', () => {
    expect(nameProblem(thingName('Project name'), 'a;b')).toBe(
      "Project name can only use letters, numbers, spaces and . , & ( ) _ ', and must start with a letter or number",
    );
    expect(nameProblem(thingName('Project name'), 'a'.repeat(101))).toBe(
      'Project name cannot exceed 100 characters',
    );
    expect(nameProblem(thingName('Project name'), 'Roadmap')).toBeNull();
  });
});
