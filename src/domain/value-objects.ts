import { randomUUID } from 'node:crypto';
import { InvalidEmailError, InvalidIdentificationError } from './errors';

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

export type IdentificationType = 'cedula' | 'ruc' | 'passport' | 'dni';

export class Identification {
  private constructor(
    public readonly type: IdentificationType,
    public readonly number: string,
  ) {}

  static create(type: string, number: string): Identification {
    const normalizedType = type.trim().toLowerCase() as IdentificationType;
    if (!['cedula', 'ruc', 'passport', 'dni'].includes(normalizedType)) {
      throw new InvalidIdentificationError('Tipo de identificación inválido. Debe ser cedula, ruc, passport o dni.');
    }
    const normalizedNumber = number.trim();

    if (normalizedType === 'cedula') {
      if (!/^\d{10}$/.test(normalizedNumber)) {
        throw new InvalidIdentificationError('La cédula debe tener exactamente 10 dígitos.');
      }
    } else if (normalizedType === 'ruc') {
      if (!/^\d{13}$/.test(normalizedNumber)) {
        throw new InvalidIdentificationError('El RUC debe tener exactamente 13 dígitos.');
      }
    } else {
      if (normalizedNumber.length < 3 || normalizedNumber.length > 20) {
        throw new InvalidIdentificationError(`${normalizedType} debe tener entre 3 y 20 caracteres.`);
      }
    }

    return new Identification(normalizedType, normalizedNumber);
  }

  equals(other: Identification): boolean {
    return this.type === other.type && this.number === other.number;
  }

  toString(): string {
    return `${this.type}:${this.number}`;
  }
}
