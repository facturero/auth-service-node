import { UnauthorizedError } from '../../domain/errors';
import { CredentialRepository, UserRepository, OrganizationRepository } from '../../domain/repositories';
import { MeOutput } from '../dtos';
import { readStoredIdentification } from '../../domain/value-objects';

export class GetMeUseCase {
  constructor(
    private readonly credentials: CredentialRepository,
    private readonly users: UserRepository,
    private readonly organizations: OrganizationRepository,
  ) {}

  async execute(userId: string, orgId: string | null, permissions: string[]): Promise<MeOutput> {
    const credential = await this.credentials.findByUserId(userId);
    if (!credential || !credential.isActive()) {
      throw new UnauthorizedError();
    }

    const user = await this.users.findById(userId);

    const orgName = orgId
      ? (await this.organizations.findById(orgId))?.name ?? null
      : null;

    const identification = readStoredIdentification(user?.identification ?? null, user?.identificationType ?? null);

    return {
      id: credential.userId,
      email: credential.email,
      emailVerified: credential.emailVerified,
      authProvider: credential.hasPassword() ? 'password' : 'google',
      fullName: user?.fullName ?? null,
      identification,
      orgId,
      orgName,
      permissions,
      createdAt: credential.createdAt.toISOString(),
      avatarFileId: user?.avatarFileId ?? null,
    };
  }
}
