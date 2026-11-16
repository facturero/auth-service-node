import { AccessContext, AccessContextResolver } from '../../application/ports';
import { AccessQuery, MembershipRepository, UserRepository } from '../../domain/repositories';
import { PLATFORM_PERMISSIONS } from '../../domain/rbac';

export class SequelizeAccessContextResolver implements AccessContextResolver {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly accessQuery: AccessQuery,
  ) {}

  async resolve(userId: string, preferredOrgId?: string | null): Promise<AccessContext> {
    const user = await this.users.findById(userId);
    const pv = user?.permissionsVersion ?? 0;
    // El platform admin (soporte) no pertenece a ninguna organización, así que
    // sus permisos no salen de `user_roles`: se le añaden los de plataforma.
    // Con organización también se añaden (soporte dentro de un tenant).
    const platformPermissions = user?.isPlatformAdmin ? [...PLATFORM_PERMISSIONS] : [];

    let orgId: string | null = null;

    if (preferredOrgId) {
      const membership = await this.memberships.find(userId, preferredOrgId);
      if (membership?.isActive()) {
        orgId = preferredOrgId;
      }
    }

    if (!orgId) {
      const activeMemberships = await this.memberships.listActiveByUser(userId);
      orgId = activeMemberships.length > 0 ? activeMemberships[0].organizationId : null;
    }

    if (orgId) {
      const [orgPermissions, countryCode] = await Promise.all([
        this.accessQuery.effectivePermissions(userId, orgId),
        this.accessQuery.countryCodeOf(orgId),
      ]);
      const permissions = [...new Set([...orgPermissions, ...platformPermissions])];
      return { orgId, countryCode, permissions, pv };
    }

    return { orgId: null, countryCode: null, permissions: platformPermissions, pv };
  }
}
