import 'dotenv/config';
import { z } from 'zod';

/**
 * Carga y valida las variables de entorno una sola vez al arrancar.
 * Si falta algo crítico, el proceso falla rápido con un mensaje claro.
 */

// Las claves PEM suelen venir con "\n" literales (en .env de una línea):
// los convertimos a saltos de línea reales.
const pem = (v: string) => v.replace(/\\n/g, '\n');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),

  JWT_PRIVATE_KEY: z.string().min(1).transform(pem),
  JWT_PUBLIC_KEY: z.string().min(1).transform(pem),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2592000),
  JWT_ISSUER: z.string().default('auth-service'),
  JWT_AUDIENCE: z.string().default('crm-api'),

  GOOGLE_CLIENT_ID: z.string().min(1),

  CORS_ORIGIN: z.string().default('*'),
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

export type AppConfig = z.infer<typeof schema>;
export const config: AppConfig = parsed.data;
