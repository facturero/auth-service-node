import { InvalidRefreshTokenError, AccountDisabledError } from '../../domain/errors';
import { TokenService, UnitOfWork } from '../ports';
import { RefreshInput, SessionOutput } from '../dtos';
import { issueSession } from '../session';

/**
 * Renueva el access token rotando el refresh token:
 * revoca el actual (apuntando al nuevo) y emite uno nuevo, de forma atómica.
 * Si el token recibido ya estaba revocado, se considera posible reuso.
 */
export class RefreshTokenUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: RefreshInput): Promise<SessionOutput> {
    const hash = this.tokenService.hashRefreshToken(input.refreshToken);

    return this.uow.execute(async (repos) => {
      const current = await repos.refreshTokens.findByHash(hash);
      if (!current || !current.isActive()) {
        throw new InvalidRefreshTokenError();
      }

      const credential = await repos.credentials.findById(current.credentialId);
      if (!credential) {
        throw new InvalidRefreshTokenError();
      }
      if (!credential.isActive()) {
        throw new AccountDisabledError();
      }

      // Emitir la nueva sesión (genera y persiste el nuevo refresh token).
      const session = await issueSession({
        credential,
        tokenService: this.tokenService,
        refreshTokens: repos.refreshTokens,
        authProvider: credential.hasPassword() ? 'password' : 'google',
        userAgent: input.userAgent,
        ip: input.ip,
      });

      // Revocar el anterior, encadenando con el nuevo (rotación).
      const newHash = this.tokenService.hashRefreshToken(session.refreshToken);
      const replacement = await repos.refreshTokens.findByHash(newHash);
      current.revoke(replacement ? replacement.id : null);
      await repos.refreshTokens.save(current);

      return session;
    });
  }
}
