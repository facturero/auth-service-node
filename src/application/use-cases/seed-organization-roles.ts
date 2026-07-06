import { Repositories } from '../../domain/repositories';
import { Role, Membership, UserRole } from '../../domain/rbac';

export interface SeedOrganizationRolesInput {
  organizationId: string;
  countryCode: string | null;
  name: string | null;
  founderUserId: string;
}

export class SeedOrganizationRolesUseCase {
  constructor(
    private readonly uow: { execute<T>(work: (repos: Repositories) => Promise<T>): Promise<T> },
  ) {}

  async execute(input: SeedOrganizationRolesInput): Promise<void> {
    await this.uow.execute(async (repos) => this.seed(input, repos));
  }

  /** Lógica compartida para reutilizar dentro de otra transacción. */
  async seed(input: SeedOrganizationRolesInput, repos: Repositories): Promise<void> {
    const templates = await repos.roles.findTemplates();

    for (const tmpl of templates) {
      const cloned = Role.createForOrg({
        organizationId: input.organizationId,
        name: tmpl.name,
        description: tmpl.description,
        isSystem: true,
      });
      await repos.roles.save(cloned);
    }

    const orgRoles = await repos.roles.findByOrganization(input.organizationId);
    const adminRole = orgRoles.find((r) => r.name === 'Administrador');
    if (!adminRole) return;

    const membership = Membership.create({
      userId: input.founderUserId,
      organizationId: input.organizationId,
      status: 'active',
    });
    await repos.memberships.save(membership);

    const ur = UserRole.assign({
      userId: input.founderUserId,
      organizationId: input.organizationId,
      roleId: adminRole.id,
    });
    await repos.userRoles.assign(ur);

    await repos.users.incrementPermissionsVersion(input.founderUserId);
  }
}
