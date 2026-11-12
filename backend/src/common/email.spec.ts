import { describe, it, expect } from 'vitest';
import { isSameEmail, maskEmail } from './email.js';

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('qaribhaider@gmail.com')).toBe('q***@gmail.com');
  });

  it('does not reveal a one-character name any further', () => {
    expect(maskEmail('q@local.com')).toBe('q***@local.com');
  });

  it('ignores surrounding spaces', () => {
    expect(maskEmail('  sam@acme.dev ')).toBe('s***@acme.dev');
  });

  it('shows nothing of a value that is not an address', () => {
    expect(maskEmail('')).toBe('***');
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(maskEmail('@acme.dev')).toBe('***');
  });
});

describe('isSameEmail', () => {
  it('matches regardless of case and surrounding spaces', () => {
    expect(isSameEmail(' Sam@Acme.dev ', 'sam@acme.dev')).toBe(true);
  });

  it('does not match different addresses', () => {
    expect(isSameEmail('sam@acme.dev', 'sam@acme.org')).toBe(false);
  });
});
