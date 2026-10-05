import { createHash } from 'node:crypto';
import { Repositories, RefreshTokenRepository } from '../../domain/repositories';
import { InvalidResetTokenError, UserNotFoundError } from '../../domain/errors';
import { PasswordHasher, UnitOfWork, TokenService, AccessContextResolver } from '../ports';
import { issueSession } from '../session';
import { AuthProvider } from '../dtos';

export interface ResetPasswordInput {
  token: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Consume el token de un solo uso del correo "restaurar contraseña", establece
 * la nueva contraseña, revoca las sesiones activas y emite una sesión nueva.
 */
export class ResetPasswordUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly tokenService: TokenService,
    private readonly accessContext: AccessContextResolver,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(input: ResetPasswordInput) {
    const tokenHash = createHash('sha256').update(input.token).digest('hex');

    const { credential } = await this.uow.execute(async (repos: Repositories) => {
      const resetToken = await repos.passwordResetTokens.findByHash(tokenHash);
      if (!resetToken || !resetToken.isValid()) {
        throw new InvalidResetTokenError();
      }

      const user = await repos.users.findById(resetToken.userId);
      if (!user) throw new UserNotFoundError();

      const credential = await repos.credentials.findByUserId(user.id);
      if (!credential) throw new UserNotFoundError('El usuario no tiene una contraseña configurada.');

      const passwordHash = await this.hasher.hash(input.password);
      credential.setPassword(passwordHash);
      await repos.credentials.save(credential);

      resetToken.consume();
      await repos.passwordResetTokens.save(resetToken);

      await repos.refreshTokens.revokeAllByCredentialId(credential.id);

      // El evento va con las organizaciones del usuario: el hash de la contraseña se espeja en las cajas POS de
      // cada organización, y el gateway solo sabe avisarles (`catalog.changed`) si el evento dice a cuáles. Sin
      // esto la contraseña nueva llegaba a la caja en el siguiente ciclo programado (hasta 5 min), y mientras
      // tanto la vieja seguía valiendo y la nueva se rechazaba (visto el 2026-10-05).
      const memberships = await repos.memberships.listActiveByUser(user.id);

      await repos.outbox.add({
        type: 'identity.user.password_reset_completed',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: { userId: user.id, email: user.email, organizationIds: memberships.map((m) => m.organizationId) },
        occurredAt: new Date(),
      });

      return { credential };
    });

    return issueSession({
      credential,
      tokenService: this.tokenService,
      refreshTokens: this.refreshTokens,
      authProvider: 'password' as AuthProvider,
      accessContext: this.accessContext,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    });
  }
}
