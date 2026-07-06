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

    const items = await Promise.all(
      roles.map(async (r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        permissions: await this.roles.getPermissionCodes(r.id),
      })),
    );

    return items;
  }
}
