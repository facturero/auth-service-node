import { Context, MiddlewareHandler } from 'hono';
import { TokenService } from '../../application/ports';
import { AppError, UnauthorizedError } from '../../domain/errors';

/**
 * Variables que el middleware de auth deja disponibles en el contexto Hono.
 */
export type AuthVariables = {
  userId: string;
  email: string;
};

/**
 * Middleware de autenticación: exige `Authorization: Bearer <accessToken>`,
 * verifica el JWT y expone userId/email en el contexto.
 */
export function makeAuthMiddleware(tokenService: TokenService): MiddlewareHandler<{
  Variables: AuthVariables;
}> {
  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError();
    }
    const token = header.slice('Bearer '.length).trim();
    const claims = await tokenService.verifyAccessToken(token);
    c.set('userId', claims.sub);
    c.set('email', claims.email);
    await next();
  };
}

/**
 * Manejador de errores central. Traduce AppError -> respuesta estándar.
 * Cualquier otro error se reporta como 500 sin filtrar detalles internos.
 */
export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json(
      {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      err.httpStatus as 400,
    );
  }

  // eslint-disable-next-line no-console
  console.error('[auth-service] error no controlado:', err);
  return c.json({ code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' }, 500);
}
