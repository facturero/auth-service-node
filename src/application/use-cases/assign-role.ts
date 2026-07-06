import { Repositories } from '../../domain/repositories';
import { UserRole } from '../../domain/rbac';
import { UnitOfWork } from '../ports';
import { UserNotFoundError, RoleNotFoundError } from '../../domain/errors';

export interface AssignRoleInput {
  organizationId: string;
  userId: string;
  roleIds: string[];
}

export class AssignRoleUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: AssignRoleInput): Promise<void> {
    await this.uow.execute(async (repos: Repositories) => {
      const user = await repos.users.findById(input.userId);
      if (!user) throw new UserNotFoundError();

      for (const roleId of input.roleIds) {
        const role = await repos.roles.findById(roleId);
        if (!role) throw new RoleNotFoundError();

        const ur = UserRole.assign({
          userId: input.userId,
          organizationId: input.organizationId,
          roleId,
        });
        await repos.userRoles.assign(ur);

        await repos.outbox.add({
          type: 'identity.user.role_assigned',
          aggregateType: 'user',
          aggregateId: input.userId,
          payload: {
            userId: input.userId,
            organizationId: input.organizationId,
            roleId,
          },
          occurredAt: new Date(),
        });
      }

      await repos.users.incrementPermissionsVersion(input.userId);
    });
  }
}
