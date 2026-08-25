import { createHash, randomBytes } from 'node:crypto';
import { Repositories } from '../../domain/repositories';
import { PasswordResetToken } from '../../domain/entities';
import { UnitOfWork, PasswordResetLinkService } from '../ports';
import {
  ForbiddenError,
  NotOrganizationMemberError,
  UserNotFoundError,
} from '../../domain/errors';

export interface RequestPasswordResetInput {
  organizationId: string;
  userId: string;
  actorId: string;
}

const RESET_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

/**
 * Dispara el correo "restaurar contraseña": emite un token de un solo uso y
 * registra un evento de notificación con el enlace. El empleado establece su
 * nueva contraseña desde el enlace (ver ResetPasswordUseCase).
 */
export class RequestPasswordResetUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly resetLinkService: PasswordResetLinkService,
  ) {}

  async execute(input: RequestPasswordResetInput): Promise<void> {
    if (input.userId === input.actorId) {
      throw new ForbiddenError('No puedes solicitar restablecer tu propia contraseña desde aquí.');
    }

    await this.uow.execute(async (repos: Repositories) => {
      const user = await repos.users.findById(input.userId);
      if (!user) throw new UserNotFoundError();

      const org = await repos.organizations.findById(input.organizationId);
      if (org?.ownerId === input.userId) {
        throw new ForbiddenError('No puedes restablecer la contraseña del dueño de la organización.');
      }

      const membership = await repos.memberships.find(input.userId, input.organizationId);
      if (!membership) throw new NotOrganizationMemberError();

      const credential = await repos.credentials.findByUserId(input.userId);
      if (!credential) {
        throw new ForbiddenError('El usuario no tiene una contraseña configurada.');
      }

      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      const resetToken = PasswordResetToken.issue({
        userId: input.userId,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      });
      await repos.passwordResetTokens.save(resetToken);

      const resetUrl = this.resetLinkService.buildResetLink(rawToken);

      const organizationName = org?.name ?? 'su organización';

      await repos.outbox.add({
        type: 'identity.user.password_reset_requested',
        aggregateType: 'user',
        aggregateId: input.userId,
        payload: {
          userId: input.userId,
          email: user.email,
          organizationId: input.organizationId,
          organizationName,
          resetUrl,
        },
        occurredAt: new Date(),
      });
    });
  }
}
