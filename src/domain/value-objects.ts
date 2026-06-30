import { randomUUID } from 'node:crypto';
import { InvalidEmailError } from './errors';

/**
 * Value Objects del dominio. Encapsulan validación e invariantes de
 * pequeños conceptos (un email siempre válido y normalizado, un id siempre uuid).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
  private constructor(public readonly value: string) {}

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 255 || !EMAIL_RE.test(normalized)) {
      throw new InvalidEmailError();
    }
    return new Email(normalized);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

export class UserId {
  private constructor(public readonly value: string) {}

  static generate(): UserId {
    return new UserId(randomUUID());
  }

  static fromString(value: string): UserId {
    return new UserId(value);
  }

  toString(): string {
    return this.value;
  }
}
