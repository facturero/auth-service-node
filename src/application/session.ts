import { Credential, RefreshToken } from '../domain/entities';
import { RefreshTokenRepository } from '../domain/repositories';
import { TokenService } from './ports';
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
  userAgent?: string | null;
  ip?: string | null;
}): Promise<SessionOutput> {
  const { credential, tokenService, refreshTokens, authProvider } = params;

  const access = await tokenService.issueAccessToken({
    sub: credential.userId,
    email: credential.email,
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
    user: {
      id: credential.userId,
      email: credential.email,
      emailVerified: credential.emailVerified,
      authProvider,
    },
  };
}
