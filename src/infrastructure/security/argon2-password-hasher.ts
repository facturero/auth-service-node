import argon2 from 'argon2';
import { PasswordHasher } from '../../application/ports';

/**
 * Hash de contraseñas con argon2id (recomendado por OWASP).
 * argon2 incorpora salt y parámetros dentro del propio hash.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
