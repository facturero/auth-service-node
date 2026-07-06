import { Identification } from '../../domain/value-objects';
import { Organization } from '../../domain/rbac';
import { RefreshTokenRepository } from '../../domain/repositories';
import { IdentificationAlreadyExistsError, UserNotFoundError } from '../../domain/errors';
import { AccessContextResolver, TokenService, UnitOfWork } from '../ports';
import { SeedOrganizationRolesUseCase } from './seed-organization-roles';
import { issueSession } from '../session';
import { SessionOutput } from '../dtos';

export interface CompleteProfileInput {
  userId: string;
  fullName: string;
  identificationType: string;
  identificationNumber: string;
  avatarFileId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}

export class CompleteProfileUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tokenService: TokenService,
    private readonly accessContext: AccessContextResolver,
    private readonly seedOrgRoles: SeedOrganizationRolesUseCase,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(input: CompleteProfileInput): Promise<SessionOutput> {
    const id = Identification.create(input.identificationType, input.identificationNumber);

    const { credential, orgId, avatarFileId } = await this.uow.execute(async (repos) => {
      const user = await repos.users.findById(input.userId);
      if (!user) {
        throw new UserNotFoundError();
      }

      const existingIdent = await repos.users.findByIdentification(id.toString());
      if (existingIdent && existingIdent.id !== input.userId) {
        throw new IdentificationAlreadyExistsError();
      }

      const credential = await repos.credentials.findByUserId(input.userId);
      if (!credential) {
        throw new UserNotFoundError();
      }

      user.completeProfile({ fullName: input.fullName, identification: id.toString(), avatarFileId: input.avatarFileId });
      await repos.users.save(user);

      await repos.outbox.add({
        type: 'identity.user.profile_completed',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: {
          userId: user.id,
          fullName: input.fullName,
          identification: id.toString(),
        },
        occurredAt: new Date(),
      });

      // Si el usuario no tiene organización, crear una automáticamente
      const memberships = await repos.memberships.listActiveByUser(input.userId);
      if (memberships.length === 0) {
        const org = Organization.create({});
        await repos.organizations.save(org);

        await this.seedOrgRoles.seed(
          { organizationId: org.id, countryCode: null, name: null, founderUserId: user.id },
          repos,
        );

        return { credential, orgId: org.id, avatarFileId: user.avatarFileId };
      }

      return { credential, orgId: memberships[0].organizationId, avatarFileId: user.avatarFileId };
    });

    return issueSession({
      credential,
      tokenService: this.tokenService,
      refreshTokens: this.refreshTokens,
      authProvider: credential.hasPassword() ? 'password' : 'google',
      accessContext: this.accessContext,
      organizationId: orgId,
      preferredOrgId: orgId,
      userAgent: input.userAgent,
      ip: input.ip,
      avatarFileId,
    });
  }
}