import { serve } from '@hono/node-server';
import { config } from './infrastructure/config';
import { sequelize } from './infrastructure/persistence/sequelize';
// Importar los modelos para registrarlos en la instancia de Sequelize.
import './infrastructure/persistence/models';
import { buildRepositories, SequelizeUnitOfWork } from './infrastructure/persistence/repositories';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher';
import { createJwtTokenService } from './infrastructure/security/jwt-token-service';
import { GoogleIdTokenVerifierImpl } from './infrastructure/google/google-id-token-verifier';
import { RegisterWithPasswordUseCase } from './application/use-cases/register-with-password';
import { LoginWithPasswordUseCase } from './application/use-cases/login-with-password';
import { LoginWithGoogleUseCase } from './application/use-cases/login-with-google';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token';
import { LogoutUseCase } from './application/use-cases/logout';
import { GetMeUseCase } from './application/use-cases/get-me';
import { createApp } from './interface/http/app';

/**
 * Composition root: aquí (y solo aquí) se instancian las implementaciones
 * concretas y se inyectan en los casos de uso y la app. El resto del código
 * depende de abstracciones.
 */

async function main(): Promise<void> {
  await sequelize.authenticate();

  // Infraestructura
  const repos = buildRepositories(); // repos sin transacción (lecturas / writes simples)
  const uow = new SequelizeUnitOfWork(); // para operaciones atómicas
  const hasher = new Argon2PasswordHasher();
  const tokenService = await createJwtTokenService(config);
  const googleVerifier = new GoogleIdTokenVerifierImpl(config.GOOGLE_CLIENT_ID);

  // Casos de uso
  const app = createApp({
    useCases: {
      register: new RegisterWithPasswordUseCase(uow, hasher, tokenService),
      login: new LoginWithPasswordUseCase(
        repos.credentials,
        repos.refreshTokens,
        hasher,
        tokenService,
      ),
      google: new LoginWithGoogleUseCase(googleVerifier, uow, tokenService),
      refresh: new RefreshTokenUseCase(uow, tokenService),
      logout: new LogoutUseCase(repos.refreshTokens, tokenService),
      getMe: new GetMeUseCase(repos.credentials),
    },
    tokenService,
    corsOrigin: config.CORS_ORIGIN,
  });

  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`auth-service escuchando en http://localhost:${info.port}`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fallo al iniciar auth-service:', e);
  process.exit(1);
});
