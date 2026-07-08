import { Repositories } from '../../domain/repositories';
import { UnitOfWork } from '../ports';
import { UserNotFoundError, NotOrganizationMemberError, ForbiddenError } from '../../domain/errors';

export interface DisableUserInput {
  organizationId: string;
  userId: string;
  actorId: string;
}

export class DisableUserUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: DisableUserInput): Promise<void> {
    if (input.userId === input.actorId) {
      throw new ForbiddenError('No puedes desactivarte a ti mismo.');
    }

    await this.uow.execute(async (repos: Repositories) => {
      const user = await repos.users.findById(input.userId);
      if (!user) throw new UserNotFoundError();

      const org = await repos.organizations.findById(input.organizationId);
      if (org?.ownerId === input.userId) {
        throw new ForbiddenError('No puedes desactivar al dueño de la organización.');
      }

      const membership = await repos.memberships.find(input.userId, input.organizationId);
      if (!membership) throw new NotOrganizationMemberError();

      const isActive = user.isActive();

      if (isActive) {
        user.disable();
        membership.disable();
      } else {
        user.activate();
        membership.activate();
      }

      await repos.users.save(user);
      await repos.memberships.save(membership);

      const orgName = org?.name ?? 'su organización';

      await repos.outbox.add({
        type: isActive ? 'identity.user.disabled' : 'identity.user.enabled',
        aggregateType: 'user',
        aggregateId: input.userId,
        payload: {
          userId: input.userId,
          email: user.email,
          organizationId: input.organizationId,
          organizationName: orgName,
        },
        occurredAt: new Date(),
      });

      await repos.users.incrementPermissionsVersion(input.userId);
    });
  }
}
