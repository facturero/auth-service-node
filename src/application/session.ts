import { Credential, RefreshToken } from '../domain/entities';
import { RefreshTokenRepository } from '../domain/repositories';
import { AccessContextResolver, TokenService } from './ports';
import { AuthProvider, SessionOutput } from './dtos';

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
