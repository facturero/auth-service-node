import { TokenService } from '../ports';
import { RefreshTokenRepository } from '../../domain/repositories';
import { LogoutInput } from '../dtos';

/**
 * Cierra sesión revocando el refresh token. Idempotente: si el token no
 * existe o ya estaba revocado, no falla (no revelamos su estado).
 */
export class LogoutUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: LogoutInput): Promise<void> {
    const hash = this.tokenService.hashRefreshToken(input.refreshToken);
    const token = await this.refreshTokens.findByHash(hash);
    if (token && token.isActive()) {
      token.revoke(null);
      await this.refreshTokens.save(token);
    }
  }
}
