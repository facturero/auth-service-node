import { describe, it, expect, beforeEach } from 'vitest';
import { ListRolesUseCase, ROLES_MAX_PAGE_SIZE } from '../application/use-cases/list-roles';
import { Role } from '../domain/rbac';
import { InMemoryRoleRepository } from './helpers';

// El listado de roles debe estar acotado: con decenas de miles de roles (que un
// usuario puede crear legitimamente) cada GET /roles cargaba todo y el gateway lo
// cortaba por timeout. Estos tests fijan el contrato de la paginacion.
describe('ListRolesUseCase', () => {
  const orgId = 'org-1';
  let roles: InMemoryRoleRepository;
  let useCase: ListRolesUseCase;

  async function seed(n: number, org = orgId) {
    for (let i = 0; i < n; i++) {
      await roles.save(Role.createForOrg({ organizationId: org, name: `rol-${i}`, description: '', isSystem: false }));
    }
  }

  beforeEach(() => {
    roles = new InMemoryRoleRepository();
    useCase = new ListRolesUseCase(roles);
  });

  it('sin parametros devuelve una pagina de hasta el tope, no todos los roles', async () => {
    await seed(ROLES_MAX_PAGE_SIZE + 50);
    const result = await useCase.execute(orgId);
    expect(result).toHaveLength(ROLES_MAX_PAGE_SIZE);
  });

  it('con pocos roles (el caso normal) devuelve todos, igual que antes', async () => {
    await seed(12);
    const result = await useCase.execute(orgId);
    expect(result).toHaveLength(12);
    expect(result[0]).toHaveProperty('permissions');
  });

  it('pagina sin solapar ni repetir filas', async () => {
    await seed(25);
    const p1 = await useCase.execute(orgId, { page: 1, pageSize: 10 });
    const p2 = await useCase.execute(orgId, { page: 2, pageSize: 10 });
    const p3 = await useCase.execute(orgId, { page: 3, pageSize: 10 });
    expect([p1.length, p2.length, p3.length]).toEqual([10, 10, 5]);
    const ids = [...p1, ...p2, ...p3].map((r) => r.id);
    expect(new Set(ids).size).toBe(25);
  });

  it('una pagina mas alla del final devuelve un array vacio', async () => {
    await seed(3);
    expect(await useCase.execute(orgId, { page: 9, pageSize: 10 })).toEqual([]);
  });

  it('satura pageSize al tope y al minimo', async () => {
    await seed(ROLES_MAX_PAGE_SIZE + 10);
    expect(await useCase.execute(orgId, { pageSize: 100000 })).toHaveLength(ROLES_MAX_PAGE_SIZE);
    expect(await useCase.execute(orgId, { pageSize: 0 })).toHaveLength(1);
    expect(await useCase.execute(orgId, { pageSize: -5 })).toHaveLength(1);
  });

  it('valores no numericos (NaN, Infinity) caen a los valores por defecto', async () => {
    await seed(7);
    expect(await useCase.execute(orgId, { page: Number('abc'), pageSize: Number('xyz') })).toHaveLength(7);
    expect(await useCase.execute(orgId, { page: Infinity, pageSize: Infinity })).toHaveLength(7);
  });

  it('page menor que 1 se trata como la primera pagina', async () => {
    await seed(4);
    const first = await useCase.execute(orgId, { page: 1, pageSize: 2 });
    expect(await useCase.execute(orgId, { page: 0, pageSize: 2 })).toEqual(first);
    expect(await useCase.execute(orgId, { page: -3, pageSize: 2 })).toEqual(first);
  });

  it('solo lista los roles de la organizacion pedida', async () => {
    await seed(3, 'org-1');
    await seed(5, 'org-2');
    expect(await useCase.execute('org-1')).toHaveLength(3);
    expect(await useCase.execute('org-2')).toHaveLength(5);
  });
});
