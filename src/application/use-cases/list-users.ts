import {
  CredentialRepository,
  OrganizationRepository,
  RoleRepository,
  UserRepository,
  UserRoleRepository,
  UserEstablishmentRepository,
} from '../../domain/repositories';

export interface UserSummaryItem {
  id: string;
  username: string;
  email: string;
  fullName: string | null;
  status: string;
  roles: string[];
  establishmentIds: string[];
  isOwner: boolean;
  hasPassword: boolean;
  passwordHash: string | null;
}

export class ListUsersUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly userRoles: UserRoleRepository,
    private readonly roles: RoleRepository,
    private readonly organizations: OrganizationRepository,
    private readonly credentials: CredentialRepository,
    private readonly userEstablishments: UserEstablishmentRepository,
  ) {}

  async execute(
    organizationId: string,
    includePasswordHash = false,
    establishmentId?: string,
  ): Promise<UserSummaryItem[]> {
    const [users, orgRoles, org, establishmentUserIds] = await Promise.all([
      this.users.listByOrganization(organizationId),
      this.roles.findByOrganization(organizationId),
      this.organizations.findById(organizationId),
      establishmentId
        ? this.userEstablishments.listUserIdsByEstablishment(establishmentId)
        : Promise.resolve<string[] | null>(null),
    ]);

    const ownerId = org?.ownerId ?? null;
    const roleNames = new Map(orgRoles.map((r) => [r.id, r.name]));

    // Si vino un establecimiento, quedamos solo con los usuarios asignados
    // PERO siempre incluimos los admins (rol "Administrador") aunque no tengan
    // asignación de establecimiento — el POS necesita sincronizarlos siempre.
    let filteredUsers = users;
    if (establishmentUserIds) {
      const adminRoleIds = orgRoles
        .filter((r) => r.name === 'Administrador')
        .map((r) => r.id);

      const adminUserIds = new Set<string>();
      for (const roleId of adminRoleIds) {
        const ids = await this.userRoles.listUserIdsByRole(roleId);
        for (const id of ids) adminUserIds.add(id);
      }

      filteredUsers = users.filter(
        (u) => establishmentUserIds.includes(u.id) || adminUserIds.has(u.id),
      );
    }

    const items = await Promise.all(
      filteredUsers.map(async (u) => {
        const [assignments, credential, establishments] = await Promise.all([
          this.userRoles.listByUserAndOrg(u.id, organizationId),
          this.credentials.findByUserId(u.id),
          this.userEstablishments.listByUser(u.id),
        ]);
        return {
          id: u.id,
          username: u.username,
          email: u.email,
          fullName: u.fullName,
          status: u.status,
          roles: assignments.map((a) => roleNames.get(a.roleId) ?? ''),
          establishmentIds: establishments.map((e) => e.establishmentId),
          isOwner: u.id === ownerId,
          hasPassword: credential?.hasPassword() ?? false,
          passwordHash: includePasswordHash ? (credential?.passwordHash ?? null) : null,
        };
      }),
    );

    return items;
  }
}
