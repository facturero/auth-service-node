import { Repositories } from '../../domain/repositories';
import { AccessContextResolver, TokenService } from '../ports';
import { SessionOutput } from '../dtos';
import { issueSession } from '../session';
import { NotOrganizationMemberError } from '../../domain/errors';
import { UnitOfWork } from '../ports';

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

      return issueSession({
        credential,
        tokenService: this.tokenService,
        refreshTokens: repos.refreshTokens,
        authProvider: credential.hasPassword() ? 'password' : 'google',
        accessContext: this.accessContext,
        preferredOrgId: input.organizationId,
        userAgent: input.userAgent,
        ip: input.ip,
      });
    });
  }
}
