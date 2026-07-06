import { AccessContext, AccessContextResolver } from '../../application/ports';
import { AccessQuery, MembershipRepository, UserRepository } from '../../domain/repositories';

export class SequelizeAccessContextResolver implements AccessContextResolver {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly accessQuery: AccessQuery,
  ) {}

  async resolve(userId: string, preferredOrgId?: string | null): Promise<AccessContext> {
    const user = await this.users.findById(userId);
    const pv = user?.permissionsVersion ?? 0;

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
      const [permissions, countryCode] = await Promise.all([
        this.accessQuery.effectivePermissions(userId, orgId),
        this.accessQuery.countryCodeOf(orgId),
      ]);
      return { orgId, countryCode, permissions, pv };
    }

    return { orgId: null, countryCode: null, permissions: [], pv };
  }
}
