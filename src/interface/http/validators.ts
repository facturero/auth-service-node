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
  identification: z
    .string()
    .min(1, 'La cédula es obligatoria.')
    .max(20, 'Máximo 20 caracteres.'),
});

export const loginSchema = z.object({
  email: z.string().email('Email inválido.'),
  password: z.string().min(1, 'La contraseña es obligatoria.'),
});

export const googleSchema = z.object({
  idToken: z.string().min(1, 'idToken es obligatorio.'),
  identification: z.string().max(20).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken es obligatorio.'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken es obligatorio.'),
});

export const switchOrgSchema = z.object({
  organizationId: z.string().uuid('organizationId debe ser un UUID válido.'),
});

export const inviteUserSchema = z.object({
  email: z.string().email('Email inválido.'),
  roleIds: z.array(z.string().uuid('roleId debe ser un UUID válido.')).min(1),
  establishmentIds: z.array(z.string().uuid('establishmentId debe ser un UUID válido.')).optional(),
});

export const assignRoleSchema = z.object({
  roleIds: z.array(z.string().uuid('roleId debe ser un UUID válido.')).min(1),
});

export const updateUserEstablishmentsSchema = z.object({
  establishmentIds: z.array(z.string().uuid('establishmentId debe ser un UUID válido.')),
});

export const createRoleSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio.').max(100),
  description: z.string().max(255).optional(),
  permissions: z.array(z.string()).default([]),
});

export const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string()).min(1, 'Debe especificar al menos un permiso.'),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1, 'El token es obligatorio.'),
  password: z
    .string()
    .min(8, 'Debe tener al menos 8 caracteres.')
    .max(128, 'Máximo 128 caracteres.'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'El token es obligatorio.'),
  password: z
    .string()
    .min(8, 'Debe tener al menos 8 caracteres.')
    .max(128, 'Máximo 128 caracteres.'),
});

export const completeProfileSchema = z.object({
  fullName: z.string().min(1, 'El nombre es obligatorio.').max(255),
  identificationType: z.enum(['cedula', 'ruc', 'passport', 'dni'], {
    errorMap: () => ({ message: 'Tipo de identificación inválido. Debe ser cedula, ruc, passport o dni.' }),
  }),
  identificationNumber: z.string().min(1, 'El número de identificación es obligatorio.').max(30),
  avatarFileId: z.string().optional(),
});

  export const provisionDeviceAccountSchema = z.object({
      organizationId: z.string().uuid('organizationId debe ser un UUID válido.'),
      emissionPointId: z.string().uuid('emissionPointId debe ser un UUID válido.'),
      deviceId: z.string().uuid('deviceId debe ser un UUID válido.'),
      label: z.string().max(255).optional(),
    });

const ipCidrRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

export const createTrustedIpSchema = z.object({
  ip: z.string().regex(ipCidrRegex, 'IP o CIDR inválido. Ejemplo: 192.168.1.100 o 10.0.0.0/8'),
  label: z.string().max(255).optional(),
  enabled: z.boolean().optional(),
});

export const updateTrustedIpSchema = z.object({
  ip: z.string().regex(ipCidrRegex, 'IP o CIDR inválido.').optional(),
  label: z.string().max(255).nullable().optional(),
  enabled: z.boolean().optional(),
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
