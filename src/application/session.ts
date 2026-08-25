import { Credential, DeviceRefreshToken, PosDevice, RefreshToken } from '../domain/entities';
import { DeviceRefreshTokenRepository, RefreshTokenRepository, Repositories } from '../domain/repositories';
import { OrganizationNotFoundError, RoleNotFoundError } from '../domain/errors';
import { AccessContextResolver, TokenService } from './ports';
import { AuthProvider, DeviceSessionOutput, SessionOutput } from './dtos';

/**
 * Helper de aplicación reutilizado por register / login / google / refresh:
 * emite el access token, genera y persiste el refresh token (guardando su
 * hash), y arma el SessionOutput. Usar el repo ligado a la transacción
 * cuando se ejecute dentro de una UnitOfWork.
 */
export async function issueSession(params: {
  credential: Credential;
  tokenService: TokenService;
  refreshTokens: RefreshTokenRepository;
  authProvider: AuthProvider;
  isNewUser?: boolean;
  needsOrg?: boolean;
  organizationId?: string;
  userAgent?: string | null;
  ip?: string | null;
  accessContext?: AccessContextResolver;
  preferredOrgId?: string | null;
  avatarFileId?: string | null;
}): Promise<SessionOutput> {
  const { credential, tokenService, refreshTokens, authProvider, accessContext, preferredOrgId } = params;

  let orgId: string | null = null;
  let countryCode: string | null = null;
  let permissions: string[] = [];
  let pv = 0;

  if (accessContext) {
    const ctx = await accessContext.resolve(credential.userId, preferredOrgId);
    orgId = ctx.orgId;
    countryCode = ctx.countryCode;
    permissions = ctx.permissions;
    pv = ctx.pv;
  }

  const access = await tokenService.issueAccessToken({
    sub: credential.userId,
    email: credential.email,
    orgId,
    countryCode,
    permissions,
    pv,
  });

  const refresh = tokenService.generateRefreshToken();
  const refreshToken = RefreshToken.issue({
    credentialId: credential.id,
    tokenHash: refresh.hash,
    expiresAt: refresh.expiresAt,
    userAgent: params.userAgent ?? null,
    ip: params.ip ?? null,
  });
  await refreshTokens.save(refreshToken);

  return {
    accessToken: access.token,
    tokenType: 'Bearer',
    expiresIn: access.expiresIn,
    refreshToken: refresh.token,
    ...(params.isNewUser !== undefined ? { isNewUser: params.isNewUser } : {}),
    ...(params.needsOrg !== undefined ? { needsOrg: params.needsOrg } : {}),
    ...(params.organizationId !== undefined ? { organizationId: params.organizationId } : {}),
    user: {
      id: credential.userId,
      email: credential.email,
      emailVerified: credential.emailVerified,
      authProvider,
      avatarFileId: params.avatarFileId ?? null,
    },
  };
}

/**
 * Emite la sesión de un terminal POS: access token con el org_id/permisos de
 * la organización (sin `sub` de usuario humano) y un refresh token ligado al
 * dispositivo (`pos_devices`), que rotará igual que el de un usuario.
 */
export async function issueDeviceSession(params: {
  device: PosDevice;
  repos: Repositories;
  tokenService: TokenService;
  deviceRefreshTokens: DeviceRefreshTokenRepository;
}): Promise<DeviceSessionOutput> {
  const { device, repos, tokenService, deviceRefreshTokens } = params;

  const org = await repos.organizations.findById(device.organizationId);
  if (!org) {
    throw new OrganizationNotFoundError();
  }

  const orgRoles = await repos.roles.findByOrganization(device.organizationId);
  const adminRole = orgRoles.find((r) => r.name === 'Administrador');
  if (!adminRole) {
    throw new RoleNotFoundError('La organización no tiene un rol Administrador para el dispositivo.');
  }
  const permissions = await repos.roles.getPermissionCodes(adminRole.id);

  const access = await tokenService.issueAccessToken({
    sub: device.id,
    email: `pos-${device.emissionPointId}@internal.pos.local`,
    orgId: device.organizationId,
    countryCode: org.countryCode,
    permissions,
    pv: 0,
  });

  const refresh = tokenService.generateRefreshToken();
  const refreshToken = DeviceRefreshToken.issue({
    posDeviceId: device.id,
    tokenHash: refresh.hash,
    expiresAt: refresh.expiresAt,
  });
  await deviceRefreshTokens.save(refreshToken);

  return {
    accessToken: access.token,
    tokenType: 'Bearer',
    expiresIn: access.expiresIn,
    refreshToken: refresh.token,
    organizationId: device.organizationId,
    emissionPointId: device.emissionPointId,
  };
}
