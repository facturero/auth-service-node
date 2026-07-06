import { Repositories } from '../../domain/repositories';
import { UnitOfWork } from '../ports';
import { RoleNotFoundError } from '../../domain/errors';

export interface UpdateRolePermissionsInput {
  organizationId: string;
  roleId: string;
  permissionCodes: string[];
}

export class UpdateRolePermissionsUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: UpdateRolePermissionsInput): Promise<void> {
    await this.uow.execute(async (repos: Repositories) => {
      const role = await repos.roles.findById(input.roleId);
      if (!role) throw new RoleNotFoundError();

      const ids = await repos.permissions.findIdsByCodes(input.permissionCodes);
      await repos.roles.setPermissions(input.roleId, ids);

      const userIds = await repos.userRoles.listUserIdsByRole(input.roleId);
      for (const uid of userIds) {
        await repos.users.incrementPermissionsVersion(uid);
      }

      await repos.outbox.add({
        type: 'identity.role.updated',
        aggregateType: 'role',
        aggregateId: input.roleId,
        payload: { roleId: input.roleId, organizationId: input.organizationId },
        occurredAt: new Date(),
      });
    });
  }
}
