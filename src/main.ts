import { serve } from '@hono/node-server';
import { config } from './infrastructure/config';
import { sequelize } from './infrastructure/persistence/sequelize';
// Importar los modelos para registrarlos en la instancia de Sequelize.
import './infrastructure/persistence/models';
import { buildRepositories, SequelizeUnitOfWork, sequelizeAccessQuery } from './infrastructure/persistence/repositories';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher';
import { SequelizeAccessContextResolver } from './infrastructure/security/access-context-resolver';
import { createJwtTokenService } from './infrastructure/security/jwt-token-service';
import { GoogleIdTokenVerifierImpl } from './infrastructure/google/google-id-token-verifier';
import { RegisterWithPasswordUseCase } from './application/use-cases/register-with-password';
import { LoginWithPasswordUseCase } from './application/use-cases/login-with-password';
import { LoginWithGoogleUseCase } from './application/use-cases/login-with-google';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token';
import { LogoutUseCase } from './application/use-cases/logout';
import { GetMeUseCase } from './application/use-cases/get-me';
import { SwitchOrganizationUseCase } from './application/use-cases/switch-organization';
import { CompleteProfileUseCase } from './application/use-cases/complete-profile';
import { ListUsersUseCase } from './application/use-cases/list-users';
import { InviteUserUseCase } from './application/use-cases/invite-user';
import { AssignRoleUseCase } from './application/use-cases/assign-role';
import { SeedOrganizationRolesUseCase } from './application/use-cases/seed-organization-roles';
import { ListRolesUseCase } from './application/use-cases/list-roles';
import { CreateRoleUseCase } from './application/use-cases/create-role';
import { UpdateRolePermissionsUseCase } from './application/use-cases/update-role-permissions';
import { ListPermissionsUseCase } from './application/use-cases/list-permissions';
import { OutboxRelay } from './infrastructure/messaging/relay';
import { OrgUpdatedConsumer } from './infrastructure/messaging/consumer';
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
  const accessContext = new SequelizeAccessContextResolver(repos.users, repos.memberships, sequelizeAccessQuery);

  // Casos de uso
  const seedOrgRoles = new SeedOrganizationRolesUseCase(uow);

  const app = createApp({
    useCases: {
      register: new RegisterWithPasswordUseCase(uow, hasher, tokenService, accessContext, seedOrgRoles),
      login: new LoginWithPasswordUseCase(
        repos.credentials,
        repos.refreshTokens,
        hasher,
        tokenService,
        accessContext,
      ),
      google: new LoginWithGoogleUseCase(googleVerifier, uow, tokenService, accessContext, seedOrgRoles),
      refresh: new RefreshTokenUseCase(uow, tokenService, accessContext),
      logout: new LogoutUseCase(repos.refreshTokens, tokenService),
      getMe: new GetMeUseCase(repos.credentials),
      switchOrg: new SwitchOrganizationUseCase(uow, tokenService, accessContext),
      completeProfile: new CompleteProfileUseCase(uow),
      listUsers: new ListUsersUseCase(repos.users),
      inviteUser: new InviteUserUseCase(uow),
      assignRole: new AssignRoleUseCase(uow),
      listRoles: new ListRolesUseCase(repos.roles),
      createRole: new CreateRoleUseCase(uow),
      updateRolePermissions: new UpdateRolePermissionsUseCase(uow),
      listPermissions: new ListPermissionsUseCase(repos.permissions),
    },
    tokenService,
    accessContext,
    corsOrigin: config.CORS_ORIGIN,
  });

  // Infraestructura de mensajería (opcional, requiere RABBITMQ_URL)
  if (config.RABBITMQ_URL) {
    const relay = new OutboxRelay();
    await relay.start(config.RABBITMQ_URL);

    const consumer = new OrgUpdatedConsumer();
    await consumer.start(config.RABBITMQ_URL);

    // eslint-disable-next-line no-console
    console.log('[messaging] outbox relay + org.updated consumer iniciados');
  }

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
