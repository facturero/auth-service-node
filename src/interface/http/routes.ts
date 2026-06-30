import { Hono } from 'hono';
import { TokenService } from '../../application/ports';
import { RegisterWithPasswordUseCase } from '../../application/use-cases/register-with-password';
import { LoginWithPasswordUseCase } from '../../application/use-cases/login-with-password';
import { LoginWithGoogleUseCase } from '../../application/use-cases/login-with-google';
import { RefreshTokenUseCase } from '../../application/use-cases/refresh-token';
import { LogoutUseCase } from '../../application/use-cases/logout';
import { GetMeUseCase } from '../../application/use-cases/get-me';
import {
  googleSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  validateJson,
} from './validators';
import {
  googleController,
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
} from './controllers';
import { AuthVariables, makeAuthMiddleware } from './middlewares';

/** Dependencias que la capa HTTP recibe del composition root. */
export interface AppDependencies {
  useCases: {
    register: RegisterWithPasswordUseCase;
    login: LoginWithPasswordUseCase;
    google: LoginWithGoogleUseCase;
    refresh: RefreshTokenUseCase;
    logout: LogoutUseCase;
    getMe: GetMeUseCase;
  };
  tokenService: TokenService;
  corsOrigin: string;
}

export function healthRoutes(): Hono {
  const r = new Hono();
  r.get('/health', (c) => c.json({ status: 'ok' }));
  return r;
}

export function authRoutes(deps: AppDependencies): Hono<{ Variables: AuthVariables }> {
  const r = new Hono<{ Variables: AuthVariables }>();
  const { useCases } = deps;

  r.post('/register', validateJson(registerSchema), registerController(useCases.register));
  r.post('/login', validateJson(loginSchema), loginController(useCases.login));
  r.post('/google', validateJson(googleSchema), googleController(useCases.google));
  r.post('/refresh', validateJson(refreshSchema), refreshController(useCases.refresh));
  r.post('/logout', validateJson(logoutSchema), logoutController(useCases.logout));

  r.get('/me', makeAuthMiddleware(deps.tokenService), meController(useCases.getMe));

  return r;
}
