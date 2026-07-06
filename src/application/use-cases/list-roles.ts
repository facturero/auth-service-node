import { RoleRepository } from '../../domain/repositories';

export interface RoleSummaryItem {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

export class ListRolesUseCase {
  constructor(private readonly roles: RoleRepository) {}

  async execute(organizationId: string): Promise<RoleSummaryItem[]> {
    const roles = await this.roles.findByOrganization(organizationId);
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
    }));
  }
}
