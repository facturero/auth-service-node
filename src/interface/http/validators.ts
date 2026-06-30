import { zValidator } from '@hono/zod-validator';
import { z, ZodSchema } from 'zod';
import { ValidationError } from '../../domain/errors';

/**
 * Esquemas Zod del borde HTTP (anillo 1 de validación). El dominio vuelve a
 * validar sus invariantes. En error, lanzamos ValidationError para que el
 * manejador responda 422 con el cuerpo estándar { code, message, details }.
 */

export const registerSchema = z.object({
  email: z.string().email('Email inválido.').max(255),
  password: z
    .string()
    .min(8, 'Debe tener al menos 8 caracteres.')
    .max(128, 'Máximo 128 caracteres.'),
});

export const loginSchema = z.object({
  email: z.string().email('Email inválido.'),
  password: z.string().min(1, 'La contraseña es obligatoria.'),
});

export const googleSchema = z.object({
  idToken: z.string().min(1, 'idToken es obligatorio.'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken es obligatorio.'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken es obligatorio.'),
});

/** Envuelve zValidator('json', schema) traduciendo errores a ValidationError. */
export function validateJson<T extends ZodSchema>(schema: T) {
  return zValidator('json', schema, (result) => {
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        message: i.message,
      }));
      throw new ValidationError(details);
    }
  });
}
