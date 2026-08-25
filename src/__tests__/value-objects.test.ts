import { describe, it, expect } from 'vitest';
import { Email, UserId, Username } from '../domain/value-objects';
import { InvalidEmailError, InvalidUsernameError } from '../domain/errors';

describe('Email', () => {
  it('creates a valid email', () => {
    const email = Email.create('Test@Example.com');
    expect(email.value).toBe('test@example.com');
  });

  it('trims whitespace', () => {
    const email = Email.create('  user@test.com  ');
    expect(email.value).toBe('user@test.com');
  });

  it('throws InvalidEmailError for empty string', () => {
    expect(() => Email.create('')).toThrow(InvalidEmailError);
  });

  it('throws InvalidEmailError for string longer than 255', () => {
    const long = 'a'.repeat(256);
    expect(() => Email.create(`${long}@test.com`)).toThrow(InvalidEmailError);
  });

  it('throws InvalidEmailError for invalid format', () => {
    expect(() => Email.create('not-an-email')).toThrow(InvalidEmailError);
    expect(() => Email.create('@test.com')).toThrow(InvalidEmailError);
    expect(() => Email.create('user@')).toThrow(InvalidEmailError);
  });

  it('equals returns true for same email', () => {
    const a = Email.create('user@test.com');
    const b = Email.create('user@test.com');
    expect(a.equals(b)).toBe(true);
  });

  it('equals returns false for different emails', () => {
    const a = Email.create('user@test.com');
    const b = Email.create('other@test.com');
    expect(a.equals(b)).toBe(false);
  });

  it('toString returns the email value', () => {
    const email = Email.create('user@test.com');
    expect(email.toString()).toBe('user@test.com');
  });
});

describe('UserId', () => {
  it('generates a uuid', () => {
    const id = UserId.generate();
    expect(id.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates unique ids', () => {
    const a = UserId.generate();
    const b = UserId.generate();
    expect(a.value).not.toBe(b.value);
  });

  it('fromString creates UserId with given value', () => {
    const val = '550e8400-e29b-41d4-a716-446655440000';
    const id = UserId.fromString(val);
    expect(id.value).toBe(val);
  });

  it('toString returns the value', () => {
    const val = '550e8400-e29b-41d4-a716-446655440000';
    const id = UserId.fromString(val);
    expect(id.toString()).toBe(val);
  });
});

describe('Username', () => {
  it('accepts letters and numbers, normalizes to uppercase', () => {
    expect(Username.create('abc1234').value).toBe('ABC1234');
    expect(Username.create('ABC1234').value).toBe('ABC1234');
    expect(Username.create('  xY987z  ').value).toBe('XY987Z');
  });

  it('rejects symbols', () => {
    for (const bad of ['ABC-123', 'abc_12', 'abc.12', 'ab c12', 'ABC@12', 'ABC$12', 'ABC/12']) {
      expect(() => Username.create(bad), `should reject ${bad}`).toThrow(InvalidUsernameError);
    }
  });

  it('rejects empty and usernames longer than 7 characters', () => {
    expect(() => Username.create('')).toThrow(InvalidUsernameError);
    expect(() => Username.create('ABCDEFGH')).toThrow(InvalidUsernameError);
  });

  it('equals and toString work', () => {
    const a = Username.create('abc1234');
    const b = Username.create('ABC1234');
    expect(a.equals(b)).toBe(true);
    expect(a.toString()).toBe('ABC1234');
  });
});
