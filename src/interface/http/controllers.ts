import { Context } from 'hono';
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
import { NoActiveOrganizationError } from '../../domain/errors';
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
    const body = c.req.valid('json' as never) as { email: string; password: string; identification: string };
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
    const body = c.req.valid('json' as never) as { idToken: string; identification?: string };
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

export function switchOrgController(useCase: SwitchOrganizationUseCase) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const body = c.req.valid('json' as never) as { organizationId: string };
    const result = await useCase.execute({
      userId: c.get('userId'),
      organizationId: body.organizationId,
      ...clientMeta(c),
    });
    return c.json(result, 200);
  };
}

export function completeProfileController(useCase: CompleteProfileUseCase) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const body = c.req.valid('json' as never) as {
      fullName: string;
      identificationType: string;
      identificationNumber: string;
    };
    const result = await useCase.execute({
      userId: c.get('userId'),
      fullName: body.fullName,
      identificationType: body.identificationType,
      identificationNumber: body.identificationNumber,
    });
    return c.json(result, 200);
  };
}

export function listUsersController(useCase: ListUsersUseCase) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const orgId = c.get('orgId');
    if (!orgId) throw new NoActiveOrganizationError();
    const result = await useCase.execute(orgId);
    return c.json(result, 200);
  };
}

export function inviteUserController(useCase: InviteUserUseCase) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const orgId = c.get('orgId');
    if (!orgId) throw new NoActiveOrganizationError();
    const body = c.req.valid('json' as never) as { email: string; roleId: string };
    const result = await useCase.execute({ organizationId: orgId, ...body });
    return c.json(result, 201);
  };
}

export function assignRoleController(useCase: AssignRoleUseCase) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const orgId = c.get('orgId');
    if (!orgId) throw new NoActiveOrganizationError();
    const userId = c.req.param('id') ?? '';
    if (!userId) return c.json({ code: 'MISSING_PARAM', message: 'userId es obligatorio.' }, 400);
    const body = c.req.valid('json' as never) as { roleId: string };
    await useCase.execute({ organizationId: orgId, userId, roleId: body.roleId });
    return c.body(null, 204);
  };
}

export function listRolesController(useCase: ListRolesUseCase) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const orgId = c.get('orgId');
    if (!orgId) throw new NoActiveOrganizationError();
    const result = await useCase.execute(orgId);
    return c.json(result, 200);
  };
}

export function createRoleController(useCase: CreateRoleUseCase) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const orgId = c.get('orgId');
    if (!orgId) throw new NoActiveOrganizationError();
    const body = c.req.valid('json' as never) as { name: string; description?: string; permissions: string[] };
    const result = await useCase.execute({
      organizationId: orgId,
      name: body.name,
      description: body.description,
      permissionCodes: body.permissions,
    });
    return c.json(result, 201);
  };
}

export function updateRolePermissionsController(useCase: UpdateRolePermissionsUseCase) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const orgId = c.get('orgId');
    if (!orgId) throw new NoActiveOrganizationError();
    const roleId = c.req.param('id') ?? '';
    if (!roleId) return c.json({ code: 'MISSING_PARAM', message: 'roleId es obligatorio.' }, 400);
    const body = c.req.valid('json' as never) as { permissions: string[] };
    await useCase.execute({ organizationId: orgId, roleId, permissionCodes: body.permissions });
    return c.body(null, 204);
  };
}

export function listPermissionsController(useCase: ListPermissionsUseCase) {
  return async (c: Context) => {
    const result = await useCase.execute();
    return c.json(result, 200);
  };
}
