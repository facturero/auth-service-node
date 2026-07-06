import { RoleRepository, UserRepository, UserRoleRepository } from '../../domain/repositories';

export interface UserSummaryItem {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  roles: string[];
}

export class ListUsersUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly userRoles: UserRoleRepository,
    private readonly roles: RoleRepository,
  ) {}

  async execute(organizationId: string): Promise<UserSummaryItem[]> {
    const [users, orgRoles] = await Promise.all([
      this.users.listByOrganization(organizationId),
      this.roles.findByOrganization(organizationId),
    ]);

    const roleNames = new Map(orgRoles.map((r) => [r.id, r.name]));

    const items = await Promise.all(
      users.map(async (u) => {
        const assignments = await this.userRoles.listByUserAndOrg(u.id, organizationId);
        return {
          id: u.id,
          email: u.email,
          fullName: u.fullName,
          status: u.status,
          roles: assignments.map((a) => roleNames.get(a.roleId) ?? ''),
        };
      }),
    );

    return items;
  }
}
