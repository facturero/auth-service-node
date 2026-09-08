import { Repositories } from '../../domain/repositories';
import { Role } from '../../domain/rbac';
import { UnitOfWork } from '../ports';

export interface CreateRoleInput {
  organizationId: string;
  name: string;
  description?: string | null;
  permissionCodes: string[];
}

export class CreateRoleUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: CreateRoleInput): Promise<{ roleId: string }> {
    return this.uow.execute(async (repos: Repositories) => {
      const role = Role.createForOrg({
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
      });
      await repos.roles.save(role);

      if (input.permissionCodes.length > 0) {
        const ids = await repos.permissions.findIdsByCodes(input.permissionCodes);
        await repos.roles.setPermissions(role.id, ids);
      }

      // Crear un rol es un cambio de privilegios: tiene que quedar en la
      // bitácora igual que `identity.role.updated`. Sin este evento se podía
      // crear un rol con permisos sensibles sin dejar rastro.
      await repos.outbox.add({
        type: 'identity.role.created',
        aggregateType: 'role',
        aggregateId: role.id,
        payload: {
          roleId: role.id,
          organizationId: input.organizationId,
          name: input.name,
          permissionCodes: input.permissionCodes,
        },
        occurredAt: new Date(),
      });

      return { roleId: role.id };
    });
  }
}
