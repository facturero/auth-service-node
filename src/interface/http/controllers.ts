import { Context } from 'hono';
import { RegisterWithPasswordUseCase } from '../../application/use-cases/register-with-password';
import { LoginWithPasswordUseCase } from '../../application/use-cases/login-with-password';
import { LoginWithGoogleUseCase } from '../../application/use-cases/login-with-google';
import { RefreshTokenUseCase } from '../../application/use-cases/refresh-token';
import { LogoutUseCase } from '../../application/use-cases/logout';
import { GetMeUseCase } from '../../application/use-cases/get-me';
import { AuthVariables } from './middlewares';

/** Datos de cliente útiles para auditoría de sesión. */
function clientMeta(c: Context): { userAgent: string | null; ip: string | null } {
  const userAgent = c.req.header('user-agent') ?? null;
  const fwd = c.req.header('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : null;
  return { userAgent, ip };
}

export function registerController(useCase: RegisterWithPasswordUseCase) {
  return async (c: Context) => {
    const body = c.req.valid('json' as never) as { email: string; password: string };
    const result = await useCase.execute({ ...body, ...clientMeta(c) });
    return c.json(result, 201);
  };
}

export function loginController(useCase: LoginWithPasswordUseCase) {
  return async (c: Context) => {
    const body = c.req.valid('json' as never) as { email: string; password: string };
    const result = await useCase.execute({ ...body, ...clientMeta(c) });
    return c.json(result, 200);
  };
}

export function googleController(useCase: LoginWithGoogleUseCase) {
  return async (c: Context) => {
    const body = c.req.valid('json' as never) as { idToken: string };
    const result = await useCase.execute({ ...body, ...clientMeta(c) });
    return c.json(result, 200);
  };
}

export function refreshController(useCase: RefreshTokenUseCase) {
  return async (c: Context) => {
    const body = c.req.valid('json' as never) as { refreshToken: string };
    const result = await useCase.execute({ ...body, ...clientMeta(c) });
    return c.json(result, 200);
  };
}

export function logoutController(useCase: LogoutUseCase) {
  return async (c: Context) => {
    const body = c.req.valid('json' as never) as { refreshToken: string };
    await useCase.execute(body);
    return c.body(null, 204);
  };
}

export function meController(useCase: GetMeUseCase) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = c.get('userId');
    const result = await useCase.execute(userId);
    return c.json(result, 200);
  };
}
