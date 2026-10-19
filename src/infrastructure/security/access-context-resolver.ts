import { AccessContext, AccessContextResolver } from '../../application/ports';
import { AccessQuery, MembershipRepository, UserRepository } from '../../domain/repositories';

/**
 * Permisos de operación de la PLATAFORMA (no de una organización): crear
 * descuentos globales, atender solicitudes de módulos a medida de cualquier
 * organización, ver eventos de auditoría sin tenant. Las migraciones de
 * 2026-08-24 los colgaron del rol «Administrador» de cada organización, y ese
 * rol lo tiene quien se registra: cualquiera podía crearse un cupón del 100 %.
 * Solo los conserva quien tiene `users.is_platform_admin`.
 */
export const PLATFORM_ONLY_PERMISSIONS = ['plugins:admin'];

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
      const effective = user?.isPlatformAdmin
        ? permissions
        : permissions.filter((p) => !PLATFORM_ONLY_PERMISSIONS.includes(p));
      return { orgId, countryCode, permissions: effective, pv };
    }

    return { orgId: null, countryCode: null, permissions: [], pv };
  }
}
