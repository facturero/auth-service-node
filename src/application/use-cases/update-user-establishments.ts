import { Repositories } from '../../domain/repositories';
import { UnitOfWork } from '../ports';
import { NotOrganizationMemberError } from '../../domain/errors';

export interface UpdateUserEstablishmentsInput {
  organizationId: string;
  userId: string;
  establishmentIds: string[];
}

export class UpdateUserEstablishmentsUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: UpdateUserEstablishmentsInput): Promise<void> {
    await this.uow.execute(async (repos: Repositories) => {
      const membership = await repos.memberships.find(input.userId, input.organizationId);
      if (!membership) throw new NotOrganizationMemberError();

      await repos.userEstablishments.replaceForUser(input.userId, input.establishmentIds);
      await repos.users.incrementPermissionsVersion(input.userId);
    });
  }
}
