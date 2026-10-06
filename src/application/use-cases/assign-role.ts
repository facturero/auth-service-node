import { Repositories } from '../../domain/repositories';
import { UserRole } from '../../domain/rbac';
import { UnitOfWork } from '../ports';
import { UserNotFoundError, RoleNotFoundError, NotOrganizationMemberError } from '../../domain/errors';

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

      const membership = await repos.memberships.find(input.userId, input.organizationId);
      if (!membership) throw new NotOrganizationMemberError();

      // Asignar un rol que el usuario ya tiene chocaba con la unicidad (user, org, rol) y salía como 500. Ahora es
      // idempotente: se salta lo que ya tiene y no emite evento por ello (visto el 2026-10-05 con «Prueba POS»).
      const already = new Set((await repos.userRoles.listByUserAndOrg(input.userId, input.organizationId)).map((ur) => ur.roleId));
      let changed = false;

      for (const roleId of new Set(input.roleIds)) {
        const role = await repos.roles.findById(roleId);
        // Un rol de OTRA organización no se puede asignar aquí. Los roles globales (organizationId null) sí.
        if (!role || (role.organizationId !== null && role.organizationId !== input.organizationId)) throw new RoleNotFoundError();
        if (already.has(roleId)) continue;

        const ur = UserRole.assign({
          userId: input.userId,
          organizationId: input.organizationId,
          roleId,
        });
        await repos.userRoles.assign(ur);
        changed = true;

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

      if (changed) await repos.users.incrementPermissionsVersion(input.userId);
    });
  }
}
