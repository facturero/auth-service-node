import { Hono } from 'hono';
import { AccessContextResolver, TokenService } from '../../application/ports';
import { RegisterWithPasswordUseCase } from '../../application/use-cases/register-with-password';
import { LoginWithPasswordUseCase } from '../../application/use-cases/login-with-password';
import { LoginWithGoogleUseCase } from '../../application/use-cases/login-with-google';
import { RefreshTokenUseCase } from '../../application/use-cases/refresh-token';
import { LogoutUseCase } from '../../application/use-cases/logout';
import { GetMeUseCase } from '../../application/use-cases/get-me';
import { SwitchOrganizationUseCase } from '../../application/use-cases/switch-organization';
import { CompleteProfileUseCase } from '../../application/use-cases/complete-profile';
import { ListUsersUseCase } from '../../application/use-cases/list-users';
import { InviteUserUseCase } from '../../application/use-cases/invite-user';
import { AssignRoleUseCase } from '../../application/use-cases/assign-role';
import { DisableUserUseCase } from '../../application/use-cases/disable-user';
import { ListRolesUseCase } from '../../application/use-cases/list-roles';
import { CreateRoleUseCase } from '../../application/use-cases/create-role';
import { UpdateRolePermissionsUseCase } from '../../application/use-cases/update-role-permissions';
import { ListPermissionsUseCase } from '../../application/use-cases/list-permissions';
import { AcceptInviteUseCase } from '../../application/use-cases/accept-invite';
import { ResetPasswordUseCase } from '../../application/use-cases/reset-password';
import { RequestPasswordResetUseCase } from '../../application/use-cases/request-password-reset';
import { ProvisionDeviceAccountUseCase } from '../../application/use-cases/provision-device-account';
import { UpdateUserEstablishmentsUseCase } from '../../application/use-cases/update-user-establishments';
import {
  acceptInviteSchema,
  assignRoleSchema,
  completeProfileSchema,
  createRoleSchema,
  googleSchema,
  inviteUserSchema,
  loginSchema,
  logoutSchema,
  provisionDeviceAccountSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  switchOrgSchema,
  updateRolePermissionsSchema,
  updateUserEstablishmentsSchema,
  validateJson,
  createTrustedIpSchema,
  updateTrustedIpSchema,
} from './validators';
import {
  acceptInviteController,
  assignRoleController,
  completeProfileController,
  createRoleController,
  disableUserController,
  googleController,
  inviteUserController,
  listPermissionsController,
  listRolesController,
  listUsersController,
  loginController,
  logoutController,
  meController,
  provisionDeviceAccountController,
  refreshController,
  registerController,
  requestPasswordResetController,
  resetPasswordController,
  switchOrgController,
  updateRolePermissionsController,
  updateUserEstablishmentsController,
  listTrustedIpsController,
  createTrustedIpController,
  deleteTrustedIpController,
  updateTrustedIpController,
  listEnabledTrustedIpsController,
} from './controllers';
import { AuthVariables, makeAuthMiddleware, requireInternalSecret, requirePermission } from './middlewares';
import { TrustedIpRepository } from '../../domain/repositories';

/** Dependencias que la capa HTTP recibe del composition root. */
export interface AppDependencies {
  useCases: {
    register: RegisterWithPasswordUseCase;
    login: LoginWithPasswordUseCase;
    google: LoginWithGoogleUseCase;
    refresh: RefreshTokenUseCase;
    logout: LogoutUseCase;
    getMe: GetMeUseCase;
    switchOrg: SwitchOrganizationUseCase;
    completeProfile: CompleteProfileUseCase;
    listUsers: ListUsersUseCase;
    inviteUser: InviteUserUseCase;
    assignRole: AssignRoleUseCase;
    disableUser: DisableUserUseCase;
    updateUserEstablishments: UpdateUserEstablishmentsUseCase;
    listRoles: ListRolesUseCase;
    createRole: CreateRoleUseCase;
    updateRolePermissions: UpdateRolePermissionsUseCase;
    listPermissions: ListPermissionsUseCase;
    acceptInvite: AcceptInviteUseCase;
    resetPassword: ResetPasswordUseCase;
    requestPasswordReset: RequestPasswordResetUseCase;
    provisionDeviceAccount: ProvisionDeviceAccountUseCase;
  };
  tokenService: TokenService;
  accessContext: AccessContextResolver;
  corsOrigin: string;
  internalSecret: string;
  trustedIpsRepository: TrustedIpRepository;
}

export function healthRoutes(): Hono {
  const r = new Hono();
  r.get('/health', (c) => c.json({ status: 'ok' }));
  return r;
}

export function authRoutes(deps: AppDependencies): Hono<{ Variables: AuthVariables }> {
  const r = new Hono<{ Variables: AuthVariables }>();
  const { useCases } = deps;
  const auth = makeAuthMiddleware(deps.tokenService);

  r.post('/register', validateJson(registerSchema), registerController(useCases.register));
  r.post('/login', validateJson(loginSchema), loginController(useCases.login));
  r.post('/google', validateJson(googleSchema), googleController(useCases.google));
  r.post('/refresh', validateJson(refreshSchema), refreshController(useCases.refresh));
  r.post('/logout', validateJson(logoutSchema), logoutController(useCases.logout));

  r.get('/me', auth, meController(useCases.getMe));
  r.post('/switch-organization', auth, validateJson(switchOrgSchema), switchOrgController(useCases.switchOrg));
  r.post('/complete-profile', auth, validateJson(completeProfileSchema), completeProfileController(useCases.completeProfile));

  r.post('/accept-invite', validateJson(acceptInviteSchema), acceptInviteController(useCases.acceptInvite));
  r.post('/password-reset', validateJson(resetPasswordSchema), resetPasswordController(useCases.resetPassword));

  return r;
}

export function adminRoutes(deps: AppDependencies): Hono<{ Variables: AuthVariables }> {
  const r = new Hono<{ Variables: AuthVariables }>();
  const { useCases } = deps;
  const auth = makeAuthMiddleware(deps.tokenService);

  r.get('/users', auth, requirePermission('user:read'), listUsersController(useCases.listUsers));
  r.post('/users/invite', auth, requirePermission('user:invite'), validateJson(inviteUserSchema), inviteUserController(useCases.inviteUser));
  r.post('/users/:id/roles', auth, requirePermission('user:assign_role'), validateJson(assignRoleSchema), assignRoleController(useCases.assignRole));
  r.post('/users/:id/disable', auth, requirePermission('user:update'), disableUserController(useCases.disableUser));
  r.post('/users/:id/password-reset', auth, requirePermission('password:change'), requestPasswordResetController(useCases.requestPasswordReset));
  r.post('/users/:id/establishments', auth, requirePermission('user:update'), validateJson(updateUserEstablishmentsSchema), updateUserEstablishmentsController(useCases.updateUserEstablishments));

  r.get('/roles', auth, requirePermission('user:read'), listRolesController(useCases.listRoles));
  r.post('/roles', auth, requirePermission('user:assign_role'), validateJson(createRoleSchema), createRoleController(useCases.createRole));
  r.patch('/roles/:id/permissions', auth, requirePermission('user:assign_role'), validateJson(updateRolePermissionsSchema), updateRolePermissionsController(useCases.updateRolePermissions));

  r.get('/permissions', auth, listPermissionsController(useCases.listPermissions));

  return r;
}

// Rutas internas (servicio-a-servicio), nunca expuestas públicamente por el
// gateway. Protegidas por X-Internal-Secret, no por JWT de usuario.
export function internalRoutes(deps: AppDependencies): Hono {
  const r = new Hono();
  const { useCases } = deps;

  r.post('/internal/device-accounts',
    requireInternalSecret(deps.internalSecret),
    validateJson(provisionDeviceAccountSchema),
    provisionDeviceAccountController(useCases.provisionDeviceAccount));

  return r;
}

/**
 * Rutas de IPs confiables.
 * - CRUD protegido por admin en /trusted-ips
 * - Endpoint público en /trusted-ips/enabled para que el gateway consulte (sin auth)
 */
export function trustedIpsRoutes(deps: AppDependencies): Hono<{ Variables: AuthVariables }> {
  const r = new Hono<{ Variables: AuthVariables }>();
  const auth = makeAuthMiddleware(deps.tokenService);
  const repo = deps.trustedIpsRepository;

  r.get('/trusted-ips', auth, requirePermission('user:read'), listTrustedIpsController(repo));
  r.post('/trusted-ips', auth, requirePermission('user:update'), validateJson(createTrustedIpSchema), createTrustedIpController(repo));
  r.patch('/trusted-ips/:id', auth, requirePermission('user:update'), validateJson(updateTrustedIpSchema), updateTrustedIpController(repo));
  r.delete('/trusted-ips/:id', auth, requirePermission('user:update'), deleteTrustedIpController(repo));

  // Endpoint público — el gateway lo llama internamente sin JWT
  r.get('/trusted-ips/enabled', listEnabledTrustedIpsController(repo));

  return r;
}
