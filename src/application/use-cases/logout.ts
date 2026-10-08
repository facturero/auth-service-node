import { TokenService } from '../ports';
import { CredentialRepository, RefreshTokenRepository } from '../../domain/repositories';
import { SessionAuditor } from '../session-audit';
import { LogoutInput } from '../dtos';

/**
 * Cierra sesión revocando el refresh token. Idempotente: si el token no
 * existe o ya estaba revocado, no falla (no revelamos su estado).
 */
export class LogoutUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokenService: TokenService,
    private readonly audit?: SessionAuditor,
    private readonly credentials?: CredentialRepository,
  ) {}

  async execute(input: LogoutInput): Promise<void> {
    const hash = this.tokenService.hashRefreshToken(input.refreshToken);
    const token = await this.refreshTokens.findByHash(hash);
    if (token && token.isActive()) {
      token.revoke(null);
      await this.refreshTokens.save(token);

      // Solo cuando de verdad se cerró una sesión: repetir el logout con el mismo token no deja otra huella.
      const credential = await this.credentials?.findById(token.credentialId);
      await this.audit?.record('auth.session.logout', {
        userId: credential?.userId,
        email: credential?.email,
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
  }
}
