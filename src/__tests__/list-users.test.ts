import { describe, it, expect, beforeEach } from 'vitest';
import { ListUsersUseCase } from '../application/use-cases/list-users';
import { InMemoryUnitOfWork } from './helpers';
import { User, Organization, Role, Membership, UserRole } from '../domain/rbac';

describe('ListUsersUseCase — permisos por usuario', () => {
  let uow: InMemoryUnitOfWork;
  let useCase: ListUsersUseCase;
  const orgId = 'org-1';

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    useCase = new ListUsersUseCase(
      uow.users, uow.userRoles, uow.roles, uow.organizations, uow.credentials, uow.userEstablishments, uow.posDevices,
    );
  });

  async function addUser(email: string, roles: Role[]): Promise<User> {
    const user = User.create({ email });
    await uow.users.save(user);
    await uow.memberships.save(Membership.create({ userId: user.id, organizationId: orgId }));
    for (const role of roles) {
      await uow.userRoles.assign(UserRole.assign({ userId: user.id, organizationId: orgId, roleId: role.id }));
    }
    return user;
  }

  async function addRole(name: string, permissionIds: string[]): Promise<Role> {
    const role = Role.createForOrg({ organizationId: orgId, name });
    await uow.roles.save(role);
    await uow.roles.setPermissions(role.id, permissionIds);
    return role;
  }

  beforeEach(async () => {
    const owner = User.create({ email: 'owner@test.com' });
    await uow.users.save(owner);
    await uow.organizations.save(Organization.create({ id: orgId, ownerId: owner.id }));
  });

  it('cada usuario sale con la unión de los permisos de sus roles, sin repetidos y ordenada', async () => {
    const vendedor = await addRole('Vendedor', ['p1', 'p2']);
    const lectura = await addRole('Solo lectura', ['p1']);
    await addUser('a@test.com', [vendedor]);
    await addUser('b@test.com', [lectura]);
    await addUser('c@test.com', [vendedor, lectura]);

    const items = await useCase.execute(orgId);
    const byEmail = Object.fromEntries(items.map((i) => [i.email, i]));

    expect(byEmail['a@test.com'].permissions).toEqual(['perm_0', 'perm_1']);
    expect(byEmail['b@test.com'].permissions).toEqual(['perm_0']);
    // Vendedor + Solo lectura: lo de Vendedor ya incluye lo de Solo lectura; no se repite.
    expect(byEmail['c@test.com'].permissions).toEqual(['perm_0', 'perm_1']);
  });

  it('un usuario sin roles sale con la lista de permisos vacía', async () => {
    await addUser('sin-roles@test.com', []);
    const items = await useCase.execute(orgId);
    expect(items.find((i) => i.email === 'sin-roles@test.com')!.permissions).toEqual([]);
  });
});
