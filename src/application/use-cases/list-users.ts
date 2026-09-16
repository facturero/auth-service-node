import {
  CredentialRepository,
  OrganizationRepository,
  PosDeviceRepository,
  RoleRepository,
  UserRepository,
  UserRoleRepository,
  UserEstablishmentRepository,
} from '../../domain/repositories';

export interface ListUsersOptions {
  /** `sub` del token que pide la lista: un usuario o un terminal POS. */
  callerId?: string;
  establishmentId?: string;
}

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
    private readonly posDevices: PosDeviceRepository,
  ) {}

  async execute(organizationId: string, options: ListUsersOptions = {}): Promise<UserSummaryItem[]> {
    const { callerId, establishmentId } = options;

    // El hash de la contraseña solo sale hacia un terminal POS emparejado con
    // ESTA organización: lo necesita para validar el login del cajero sin
    // internet. A una persona no se le entrega nunca, tenga el permiso que
    // tenga: con el hash se puede atacar la contraseña fuera de línea, sin
    // límite de intentos. El `sub` de un token de terminal es el id de su fila
    // en `pos_devices`; el de una persona nunca está ahí.
    const callerDevice = callerId ? await this.posDevices.findById(callerId) : null;
    const includePasswordHash = callerDevice?.organizationId === organizationId;

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
