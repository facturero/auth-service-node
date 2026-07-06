import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Carga y valida las variables de entorno una sola vez al arrancar.
 * Si falta algo crítico, el proceso falla rápido con un mensaje claro.
 */

// Las claves PEM inline (en .env de una línea) suelen traer "\n" literales:
// los convertimos a saltos de línea reales. Los archivos .pem ya vienen bien.
const pem = (v: string) => v.replace(/\\n/g, '\n');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),

  // Claves RSA: opcionales como variable (PEM inline). Si no se definen,
  // se leen de los archivos indicados por *_PATH (por defecto en certs/).
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_PRIVATE_KEY_PATH: z.string().default('certs/private.pem'),
  JWT_PUBLIC_KEY_PATH: z.string().default('certs/public.pem'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2592000),
  JWT_ISSUER: z.string().default('auth-service'),
  JWT_AUDIENCE: z.string().default('crm-api'),

  GOOGLE_CLIENT_ID: z.string().min(1),

  CORS_ORIGIN: z.string().default('*'),

  RABBITMQ_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Configuración de entorno inválida:\n${issues}`);
  process.exit(1);
}

const env = parsed.data;

/**
 * Resuelve una clave: prioriza la variable de entorno (PEM inline, útil en
 * producción con secretos inyectados); si no está, lee el archivo .pem.
 */
function loadKey(inline: string | undefined, filePath: string, label: string): string {
  if (inline && inline.trim().length > 0) {
    return pem(inline);
  }
  try {
    return readFileSync(resolve(filePath), 'utf8');
  } catch {
    // eslint-disable-next-line no-console
    console.error(
      `No se pudo cargar ${label}: define la variable de entorno ${label} ` +
        `(PEM inline) o coloca el archivo en "${filePath}".`,
    );
    process.exit(1);
  }
}

const JWT_PRIVATE_KEY = loadKey(env.JWT_PRIVATE_KEY, env.JWT_PRIVATE_KEY_PATH, 'JWT_PRIVATE_KEY');
const JWT_PUBLIC_KEY = loadKey(env.JWT_PUBLIC_KEY, env.JWT_PUBLIC_KEY_PATH, 'JWT_PUBLIC_KEY');

export interface AppConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  JWT_PRIVATE_KEY: string;
  JWT_PUBLIC_KEY: string;
  JWT_ACCESS_TTL: number;
  JWT_REFRESH_TTL: number;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  GOOGLE_CLIENT_ID: string;
  CORS_ORIGIN: string;
  RABBITMQ_URL?: string;
}

export const config: AppConfig = {
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  DB_HOST: env.DB_HOST,
  DB_PORT: env.DB_PORT,
  DB_USER: env.DB_USER,
  DB_PASSWORD: env.DB_PASSWORD,
  DB_NAME: env.DB_NAME,
  JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY,
  JWT_ACCESS_TTL: env.JWT_ACCESS_TTL,
  JWT_REFRESH_TTL: env.JWT_REFRESH_TTL,
  JWT_ISSUER: env.JWT_ISSUER,
  JWT_AUDIENCE: env.JWT_AUDIENCE,
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
  CORS_ORIGIN: env.CORS_ORIGIN,
  RABBITMQ_URL: env.RABBITMQ_URL,
};
