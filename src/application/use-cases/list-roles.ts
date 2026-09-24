import { RoleRepository } from '../../domain/repositories';

export interface RoleSummaryItem {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

export interface ListRolesInput {
  page?: number;
  pageSize?: number;
}

/** Tope por respuesta. Sin params se devuelve la primera pagina de hasta este tamaño. */
export const ROLES_MAX_PAGE_SIZE = 500;

export class ListRolesUseCase {
  constructor(private readonly roles: RoleRepository) {}

  async execute(organizationId: string, input: ListRolesInput = {}): Promise<RoleSummaryItem[]> {
    // Paginacion acotada, como en customer-service: la respuesta sigue siendo un
    // array (el frontend lo consume asi). Antes cargaba TODOS los roles y hacia un
    // `IN (...)` con todos sus ids: con ~76 mil roles (creados por las pruebas de
    // carga) cada peticion pasaba de los 20s y el gateway la cortaba por timeout.
    // Los valores no numericos o fuera de rango se sanean en vez de llegar a la query.
    const pageSize = clampInt(input.pageSize, ROLES_MAX_PAGE_SIZE, 1, ROLES_MAX_PAGE_SIZE);
    const page = clampInt(input.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const roles = await this.roles.listByOrganizationPage(organizationId, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    // Permisos de los roles de la pagina en una sola query (antes: getPermissionCodes
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

/** Entero acotado a [min, max]; cualquier cosa que no sea un numero finito cae al valor por defecto. */
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
