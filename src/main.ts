import './infrastructure/telemetry/otel';
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
import { OrganizationHttpRepository } from './infrastructure/http/organization-http-repository';
import { SwitchOrganizationUseCase } from './application/use-cases/switch-organization';
import { CompleteProfileUseCase } from './application/use-cases/complete-profile';
import { ListUsersUseCase } from './application/use-cases/list-users';
import { InviteUserUseCase } from './application/use-cases/invite-user';
import { AssignRoleUseCase } from './application/use-cases/assign-role';
import { RemoveRoleUseCase } from './application/use-cases/remove-role';
import { DeleteRoleUseCase } from './application/use-cases/delete-role';
import { DisableUserUseCase } from './application/use-cases/disable-user';
import { SeedOrganizationRolesUseCase } from './application/use-cases/seed-organization-roles';
import { ListRolesUseCase } from './application/use-cases/list-roles';
import { CreateRoleUseCase } from './application/use-cases/create-role';
import { UpdateRolePermissionsUseCase } from './application/use-cases/update-role-permissions';
import { ListPermissionsUseCase } from './application/use-cases/list-permissions';
import { AcceptInviteUseCase } from './application/use-cases/accept-invite';
import { ResetPasswordUseCase } from './application/use-cases/reset-password';
import { RequestPasswordResetUseCase } from './application/use-cases/request-password-reset';
import { ProvisionDeviceAccountUseCase } from './application/use-cases/provision-device-account';
import { ManageTrustedIpsUseCase } from './application/use-cases/manage-trusted-ips';
import { SessionAuditor } from './application/session-audit';
import { UpdateUserEstablishmentsUseCase } from './application/use-cases/update-user-establishments';
import { OutboxRelay, InboxConsumer } from '@facturero/outbox-relay';
import { orgUpdatedHandler } from './infrastructure/messaging/consumer';
import { SignedInviteTokenService } from './infrastructure/security/invite-token-service';
import { SimplePasswordResetLinkService } from './infrastructure/security/password-reset-link-service';
import { createApp } from './interface/http/app';

/**
 * Composition root: aquí (y solo aquí) se instancian las implementaciones
 * concretas y se inyectan en los casos de uso y la app. El resto del código
 * depende de abstracciones.
 */
async function main(): Promise<void> {
  await sequelize.authenticate();
  await sequelize.sync();

  // Infraestructura
  const repos = buildRepositories(); // repos sin transacción (lecturas / writes simples)
  let relay: OutboxRelay | undefined;
  const uow = new SequelizeUnitOfWork((tx) => relay?.attachToTransaction(tx)); // para operaciones atómicas
  const hasher = new Argon2PasswordHasher();
  const tokenService = await createJwtTokenService(config);
  const googleVerifier = new GoogleIdTokenVerifierImpl(config.GOOGLE_CLIENT_ID);
  const accessContext = new SequelizeAccessContextResolver(repos.users, repos.memberships, sequelizeAccessQuery);
  // Solo para GetMeUseCase: el read-model local de `organizations` se llena
  // vía RabbitMQ y puede tardar ~30s en propagar tras completar el perfil de
  // la organización (ver comentario en organization-http-repository.ts).
  const orgHttpRepo = new OrganizationHttpRepository(config.ORG_SERVICE_URL);

  // Servicios
  const seedOrgRoles = new SeedOrganizationRolesUseCase(uow);
  const inviteTokenService = new SignedInviteTokenService({
    frontendUrl: config.FRONTEND_URL,
    secret: config.INVITE_TOKEN_SECRET,
    jwtPrivateKey: config.JWT_PRIVATE_KEY,
    ttlSeconds: config.INVITE_TOKEN_TTL_HOURS * 3600,
    allowLegacy: config.INVITE_ALLOW_LEGACY_TOKENS,
    // Cada uso de un enlace viejo (sin firma) queda en el log: sirve para saber cuándo se puede apagar la transición.
    onLegacyToken: (userId) => console.warn(`[invite] se aceptó un token de invitación SIN firma (usuario ${userId})`),
  });
  const passwordResetLinkService = new SimplePasswordResetLinkService(config.FRONTEND_URL);

  // Los eventos de sesión (login, logout...) los publica fuera de cualquier transacción; ver SessionAuditor.
  const sessionAudit = new SessionAuditor(repos.outbox);

  const app = createApp({
    useCases: {
      register: new RegisterWithPasswordUseCase(uow, hasher, tokenService, accessContext, seedOrgRoles, repos.refreshTokens),
      login: new LoginWithPasswordUseCase(
        repos.credentials,
        repos.refreshTokens,
        hasher,
        tokenService,
        accessContext,
        sessionAudit,
      ),
      google: new LoginWithGoogleUseCase(googleVerifier, uow, tokenService, accessContext, seedOrgRoles, repos.refreshTokens, sessionAudit),
      refresh: new RefreshTokenUseCase(uow, tokenService, accessContext),
      logout: new LogoutUseCase(repos.refreshTokens, tokenService, sessionAudit, repos.credentials),
      getMe: new GetMeUseCase(repos.credentials, repos.users, orgHttpRepo),
      switchOrg: new SwitchOrganizationUseCase(uow, tokenService, accessContext),
      completeProfile: new CompleteProfileUseCase(uow, tokenService, accessContext, seedOrgRoles, repos.refreshTokens),
      listUsers: new ListUsersUseCase(repos.users, repos.userRoles, repos.roles, repos.organizations, repos.credentials, repos.userEstablishments, repos.posDevices),
      inviteUser: new InviteUserUseCase(uow, inviteTokenService),
      assignRole: new AssignRoleUseCase(uow),
      removeRole: new RemoveRoleUseCase(uow),
      deleteRole: new DeleteRoleUseCase(uow),
      disableUser: new DisableUserUseCase(uow),
      updateUserEstablishments: new UpdateUserEstablishmentsUseCase(uow),
      listRoles: new ListRolesUseCase(repos.roles),
      createRole: new CreateRoleUseCase(uow),
      updateRolePermissions: new UpdateRolePermissionsUseCase(uow),
      listPermissions: new ListPermissionsUseCase(repos.permissions),
      acceptInvite: new AcceptInviteUseCase(uow, hasher, tokenService, accessContext, repos.refreshTokens, inviteTokenService),
      resetPassword: new ResetPasswordUseCase(uow, hasher, tokenService, accessContext, repos.refreshTokens),
      requestPasswordReset: new RequestPasswordResetUseCase(uow, passwordResetLinkService),
      provisionDeviceAccount: new ProvisionDeviceAccountUseCase(uow, tokenService),
      trustedIps: new ManageTrustedIpsUseCase(uow),
    },
    tokenService,
    accessContext,
    corsOrigin: config.CORS_ORIGIN,
    internalSecret: config.INTERNAL_SERVICE_SECRET,
    trustedIpsRepository: repos.trustedIps,
  });

  // Infraestructura de mensajería (opcional, requiere RABBITMQ_URL)
  if (config.RABBITMQ_URL) {
    relay = new OutboxRelay({
      sequelize,
      rabbitmqUrl: config.RABBITMQ_URL,
      exchange: 'crm.events',
    });
    await relay.start();

    const consumer = new InboxConsumer({
      sequelize,
      rabbitmqUrl: config.RABBITMQ_URL,
      exchange: 'crm.events',
      queue: 'auth-service.org.updated',
      bindings: ['organization.org.updated'],
      handlers: [orgUpdatedHandler],
    });
    await consumer.start();

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
