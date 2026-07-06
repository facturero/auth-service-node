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
import { ListRolesUseCase } from '../../application/use-cases/list-roles';
import { CreateRoleUseCase } from '../../application/use-cases/create-role';
import { UpdateRolePermissionsUseCase } from '../../application/use-cases/update-role-permissions';
import { ListPermissionsUseCase } from '../../application/use-cases/list-permissions';
import {
  assignRoleSchema,
  completeProfileSchema,
  createRoleSchema,
  googleSchema,
  inviteUserSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  switchOrgSchema,
  updateRolePermissionsSchema,
  validateJson,
} from './validators';
import {
  assignRoleController,
  completeProfileController,
  createRoleController,
  googleController,
  inviteUserController,
  listPermissionsController,
  listRolesController,
  listUsersController,
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
  switchOrgController,
  updateRolePermissionsController,
} from './controllers';
import { AuthVariables, makeAuthMiddleware, requirePermission } from './middlewares';

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
    listRoles: ListRolesUseCase;
    createRole: CreateRoleUseCase;
    updateRolePermissions: UpdateRolePermissionsUseCase;
    listPermissions: ListPermissionsUseCase;
  };
  tokenService: TokenService;
  accessContext: AccessContextResolver;
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
  const auth = makeAuthMiddleware(deps.tokenService);

  r.post('/register', validateJson(registerSchema), registerController(useCases.register));
  r.post('/login', validateJson(loginSchema), loginController(useCases.login));
  r.post('/google', validateJson(googleSchema), googleController(useCases.google));
  r.post('/refresh', validateJson(refreshSchema), refreshController(useCases.refresh));
  r.post('/logout', validateJson(logoutSchema), logoutController(useCases.logout));

  r.get('/me', auth, meController(useCases.getMe));
  r.post('/switch-organization', auth, validateJson(switchOrgSchema), switchOrgController(useCases.switchOrg));
  r.post('/complete-profile', auth, validateJson(completeProfileSchema), completeProfileController(useCases.completeProfile));

  return r;
}

export function adminRoutes(deps: AppDependencies): Hono<{ Variables: AuthVariables }> {
  const r = new Hono<{ Variables: AuthVariables }>();
  const { useCases } = deps;
  const auth = makeAuthMiddleware(deps.tokenService);

  r.get('/users', auth, requirePermission('user:read'), listUsersController(useCases.listUsers));
  r.post('/users/invite', auth, requirePermission('user:invite'), validateJson(inviteUserSchema), inviteUserController(useCases.inviteUser));
  r.post('/users/:id/roles', auth, requirePermission('user:assign_role'), validateJson(assignRoleSchema), assignRoleController(useCases.assignRole));

  r.get('/roles', auth, requirePermission('user:read'), listRolesController(useCases.listRoles));
  r.post('/roles', auth, requirePermission('user:assign_role'), validateJson(createRoleSchema), createRoleController(useCases.createRole));
  r.patch('/roles/:id/permissions', auth, requirePermission('user:assign_role'), validateJson(updateRolePermissionsSchema), updateRolePermissionsController(useCases.updateRolePermissions));

  r.get('/permissions', auth, listPermissionsController(useCases.listPermissions));

  return r;
}
