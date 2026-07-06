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

      return { roleId: role.id };
    });
  }
}
