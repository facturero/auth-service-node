import { RoleRepository } from '../../domain/repositories';

export interface RoleSummaryItem {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

export class ListRolesUseCase {
  constructor(private readonly roles: RoleRepository) {}

  async execute(organizationId: string): Promise<RoleSummaryItem[]> {
    const roles = await this.roles.findByOrganization(organizationId);

    // Permisos de TODOS los roles en una sola query (antes: getPermissionCodes
    // por rol → N+1 que hacía colapsar GET /roles a ~30s con muchos roles).
    const permsByRole = await this.roles.getPermissionCodesForRoles(roles.map((r) => r.id));

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: permsByRole.get(r.id) ?? [],
    }));
  }
}
