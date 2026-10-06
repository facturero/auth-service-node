import { Repositories } from '../../domain/repositories';
import { UnitOfWork } from '../ports';
import { RoleNotFoundError, CannotModifySystemRoleError } from '../../domain/errors';

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
      // Un rol de OTRA organización se trata como inexistente: sin esta comprobación, quien tuviera `user:assign_role` en su
      // organización podía cambiar los permisos de un rol ajeno conociendo su id.
      if (!role || role.organizationId !== input.organizationId) throw new RoleNotFoundError();
      if (role.isSystem) throw new CannotModifySystemRoleError();

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
        payload: {
          roleId: input.roleId,
          organizationId: input.organizationId,
          // Incluye los usuarios afectados para que el gateway invalide la
          // caché de pv y notifique por socket (BUG #9).
          userIds,
        },
        occurredAt: new Date(),
      });
    });
  }
}
