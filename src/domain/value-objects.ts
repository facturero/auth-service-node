import { randomUUID } from 'node:crypto';
import { InvalidEmailError, InvalidIdentificationError, InvalidUsernameError } from './errors';

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

const IDENTIFICATION_TYPES: IdentificationType[] = ['cedula', 'ruc', 'passport', 'dni'];

/**
 * Lo que hay guardado en `users.identification` + `users.identification_type` -> { type, number }.
 *  - Formato actual: el número solo, y el tipo en su columna.
 *  - Formato viejo de `complete-profile`: "cedula:1710034065" en una sola columna (sin tipo aparte).
 *  - Registro con contraseña / Google: el número sin tipo; se asume cédula, como siempre.
 */
export function readStoredIdentification(
  identification: string | null,
  identificationType: string | null,
): { type: string; number: string } | null {
  if (!identification) return null;
  if (identificationType) return { type: identificationType, number: identification };
  const idx = identification.indexOf(':');
  if (idx > 0) {
    const type = identification.slice(0, idx);
    if ((IDENTIFICATION_TYPES as string[]).includes(type)) return { type, number: identification.slice(idx + 1) };
  }
  return { type: 'cedula', number: identification };
}

/**
 * Todos los valores con los que puede estar guardado un número, para buscar duplicados sin que importe el formato:
 * el número solo y el viejo "tipo:número" de cada tipo. Acepta también que le pasen ya el "tipo:número".
 */
export function identificationLookupValues(identification: string): string[] {
  const parsed = readStoredIdentification(identification, null);
  const number = parsed ? parsed.number : identification;
  return [number, ...IDENTIFICATION_TYPES.map((t) => `${t}:${number}`)];
}

// Solo letras (a-z, A-Z) y números (0-9): sin espacios ni símbolos. Hasta 7
// caracteres, que es lo que admite la columna `users.username` (VARCHAR(7)).
// Se normaliza a mayúsculas: la unicidad de la tabla usa el código en
// mayúsculas, así que 'abc1234' y 'ABC1234' serían el mismo nombre de usuario.
const USERNAME_RE = /^[A-Za-z0-9]{1,7}$/;

export class Username {
  private constructor(public readonly value: string) {}

  static create(raw: string): Username {
    const normalized = raw.trim().toUpperCase();
    if (!USERNAME_RE.test(normalized)) {
      throw new InvalidUsernameError();
    }
    return new Username(normalized);
  }

  equals(other: Username): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
