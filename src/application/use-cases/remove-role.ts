import { Repositories } from '../../domain/repositories';
import { UnitOfWork } from '../ports';
import {
  UserNotFoundError,
  RoleNotFoundError,
  NotOrganizationMemberError,
  LastAdminRemovalError,
  UserMustKeepRoleError,
} from '../../domain/errors';

export interface RemoveRoleInput {
  organizationId: string;
  userId: string;
  roleId: string;
}

/** Quita UN rol a un usuario de la organización. Antes solo se podía añadir roles, nunca quitarlos. */
export class RemoveRoleUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: RemoveRoleInput): Promise<void> {
    await this.uow.execute(async (repos: Repositories) => {
      const user = await repos.users.findById(input.userId);
      if (!user) throw new UserNotFoundError();
      const membership = await repos.memberships.find(input.userId, input.organizationId);
      if (!membership) throw new NotOrganizationMemberError();

      const role = await repos.roles.findById(input.roleId);
      if (!role || (role.organizationId !== null && role.organizationId !== input.organizationId)) throw new RoleNotFoundError();

      const current = await repos.userRoles.listByUserAndOrg(input.userId, input.organizationId);
      // Quitar un rol que no tiene es un no-op: el resultado pedido ya se cumple.
      if (!current.some((ur) => ur.roleId === input.roleId)) return;

      // Sin roles el usuario no tendría ningún permiso pero seguiría "activo": un estado confuso. Para sacarlo de la
      // organización está «deshabilitar».
      if (current.length === 1) throw new UserMustKeepRoleError();

      // Mismo guard anti-lockout que al deshabilitar: no se le quita «Administrador» al último administrador activo. El
      // dueño de la organización no cuenta como respaldo (igual que en disable-user).
      if (role.name === 'Administrador') {
        const org = await repos.organizations.findById(input.organizationId);
        const adminRoleIds = (await repos.roles.findByOrganization(input.organizationId))
          .filter((r) => r.name === 'Administrador')
          .map((r) => r.id);
        let otherActiveAdmins = 0;
        for (const adminRoleId of adminRoleIds) {
          for (const uid of await repos.userRoles.listUserIdsByRole(adminRoleId)) {
            if (uid === input.userId || uid === org?.ownerId) continue;
            const m = await repos.memberships.find(uid, input.organizationId);
            if (m?.isActive()) otherActiveAdmins += 1;
          }
        }
        if (otherActiveAdmins === 0) throw new LastAdminRemovalError();
      }

      await repos.userRoles.remove(input.userId, input.organizationId, input.roleId);
      await repos.outbox.add({
        type: 'identity.user.role_removed',
        aggregateType: 'user',
        aggregateId: input.userId,
        payload: {
          userId: input.userId,
          organizationId: input.organizationId,
          roleId: input.roleId,
        },
        occurredAt: new Date(),
      });
      await repos.users.incrementPermissionsVersion(input.userId);
    });
  }
}
