import { Repositories } from '../../domain/repositories';
import { AccessContextResolver, TokenService } from '../ports';
import { SessionOutput } from '../dtos';
import { issueSession } from '../session';
import { NotOrganizationMemberError } from '../../domain/errors';
import { UnitOfWork } from '../ports';
import { buildSessionEvent } from '../session-audit';

export interface SwitchOrganizationInput {
  userId: string;
  organizationId: string;
  userAgent?: string | null;
  ip?: string | null;
}

export class SwitchOrganizationUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tokenService: TokenService,
    private readonly accessContext: AccessContextResolver,
  ) {}

  async execute(input: SwitchOrganizationInput): Promise<SessionOutput> {
    return this.uow.execute(async (repos: Repositories) => {
      const membership = await repos.memberships.find(input.userId, input.organizationId);
      if (!membership || !membership.isActive()) {
        throw new NotOrganizationMemberError();
      }

      const credential = await repos.credentials.findByUserId(input.userId);
      if (!credential || !credential.isActive()) {
        throw new NotOrganizationMemberError();
      }

      const contextOut = { orgId: null as string | null };
      const session = await issueSession({
        contextOut,
        credential,
        tokenService: this.tokenService,
        refreshTokens: repos.refreshTokens,
        authProvider: credential.hasPassword() ? 'password' : 'google',
        accessContext: this.accessContext,
        preferredOrgId: input.organizationId,
        userAgent: input.userAgent,
        ip: input.ip,
      });

      await repos.outbox.add(
        buildSessionEvent('auth.session.org_switched', {
          userId: credential.userId,
          email: credential.email,
          organizationId: input.organizationId,
          ip: input.ip,
          userAgent: input.userAgent,
        }),
      );
      return session;
    });
  }
}
