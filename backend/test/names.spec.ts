import { describe, it, expect } from 'vitest';
import { personName, thingName } from '../src/common/dto/name.schema.js';
import { UpdateBoardSchema, CreateBoardDto } from '../src/boards/dto/board.dto.js';
import { CreateProjectSchema } from '../src/projects/dto/project.dto.js';
import { CreateWorkspaceSchema, InviteMemberSchema } from '../src/workspaces/dto/workspace.dto.js';
import { V1_WRAPPED_KEY } from './integration/fixtures.js';

/**
 * The rule for names, as a table. The browser has the same table in `frontend/src/lib/names.test.ts`;
 * the two projects share no code, so these cases are how they stay in step.
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
  ['a b', false], // a non-breaking space is not a plain space
  ['a​b', false], // a zero-width space
  ['😀 party', false],
  ['(first)', false], // must start with a letter or number
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

describe('Names accepted by the API', () => {
  it.each(THING_NAME_CASES)(
    'workspace, project and canvas name %j is accepted: %s',
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
    const result = thingName('Project name').safeParse('a;b');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Project name can only use letters, numbers, spaces and . , & ( ) _ ', and must start with a letter or number",
    );
  });

  it('applies to every route that accepts a name', () => {
    const keys = {
      encryptedProjectKey: V1_WRAPPED_KEY,
      creatorEncryptedProjectKey: V1_WRAPPED_KEY,
    };
    const id = '2a6c7e8f-3b4d-4c5e-9f01-23456789abcd';

    expect(CreateProjectSchema.safeParse({ id, name: 'a;b', ...keys }).success).toBe(false);
    expect(
      CreateWorkspaceSchema.safeParse({
        id,
        name: 'a;b',
        encryptedOrgKey: V1_WRAPPED_KEY,
        project: { id, name: 'Tech', ...keys },
      }).success,
    ).toBe(false);
    expect(
      CreateWorkspaceSchema.safeParse({
        id,
        name: 'Acme',
        encryptedOrgKey: V1_WRAPPED_KEY,
        project: { id, name: 'Tech;', ...keys },
      }).success,
    ).toBe(false);
    expect(UpdateBoardSchema.safeParse({ title: 'a;b' }).success).toBe(false);
    expect(
      CreateBoardDto.schema.safeParse({
        id,
        projectId: 'p1',
        title: 'a;b',
        encryptedBoardKey: V1_WRAPPED_KEY,
        projectKeyVersion: 1,
      }).success,
    ).toBe(false);
  });
});

describe('Invitation email', () => {
  it('is trimmed and lower-cased, and refused when it is not an address or is far too long', () => {
    expect(InviteMemberSchema.parse({ email: '  Sam@Example.COM ' }).email).toBe('sam@example.com');
    expect(InviteMemberSchema.safeParse({ email: 'not an email' }).success).toBe(false);
    expect(InviteMemberSchema.safeParse({ email: `${'a'.repeat(250)}@x.io` }).success).toBe(false);
  });
});
