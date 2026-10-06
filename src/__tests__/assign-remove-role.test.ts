import { describe, it, expect, beforeEach } from 'vitest';
import { AssignRoleUseCase } from '../application/use-cases/assign-role';
import { RemoveRoleUseCase } from '../application/use-cases/remove-role';
import { InMemoryUnitOfWork } from './helpers';
import { User, Organization, Role, Membership, UserRole } from '../domain/rbac';
import {
  LastAdminRemovalError,
  NotOrganizationMemberError,
  RoleNotFoundError,
  UserMustKeepRoleError,
  UserNotFoundError,
} from '../domain/errors';

// Asignar un rol repetido salía como 500 (choque con la unicidad) y no había forma de quitar un rol: el rol de pruebas
// «Prueba POS» se quedó pegado a un usuario (2026-10-05).
describe('asignar y quitar roles', () => {
  const orgId = 'org-1';
  let uow: InMemoryUnitOfWork;
  let assign: AssignRoleUseCase;
  let remove: RemoveRoleUseCase;

  const addUser = async (): Promise<User> => {
    const u = User.create({ email: `u-${Math.random()}@test.com` });
    await uow.users.save(u);
    await uow.memberships.save(Membership.create({ userId: u.id, organizationId: orgId }));
    return u;
  };
  const addRole = async (name: string, organizationId: string | null = orgId): Promise<Role> => {
    const r = Role.createForOrg({ organizationId: organizationId ?? orgId, name });
    await uow.roles.save(r);
    return r;
  };
  const give = (userId: string, role: Role) =>
    uow.userRoles.assign(UserRole.assign({ userId, organizationId: orgId, roleId: role.id }));
  const rolesOf = async (userId: string) => (await uow.userRoles.listByUserAndOrg(userId, orgId)).map((ur) => ur.roleId);
  const eventsOf = (type: string) => uow.outbox.events.filter((e) => e.type === type);

  beforeEach(async () => {
    uow = new InMemoryUnitOfWork();
    assign = new AssignRoleUseCase(uow);
    remove = new RemoveRoleUseCase(uow);
    const owner = User.create({ id: 'owner', email: 'owner@test.com' });
    await uow.users.save(owner);
    await uow.organizations.save(Organization.create({ id: orgId, ownerId: 'owner' }));
  });

  describe('asignar', () => {
    it('asignar un rol que ya tiene es un no-op: ni error ni evento ni versión de permisos nueva', async () => {
      const u = await addUser();
      const vendedor = await addRole('Vendedor');
      await give(u.id, vendedor);
      const antes = (await uow.users.findById(u.id))!.permissionsVersion;

      await assign.execute({ organizationId: orgId, userId: u.id, roleIds: [vendedor.id] });

      expect(await rolesOf(u.id)).toEqual([vendedor.id]);
      expect(eventsOf('identity.user.role_assigned')).toHaveLength(0);
      expect((await uow.users.findById(u.id))!.permissionsVersion).toBe(antes);
    });

    it('mezcla de rol nuevo y repetido: solo se añade el nuevo, y un id repetido en la petición cuenta una vez', async () => {
      const u = await addUser();
      const vendedor = await addRole('Vendedor');
      const cajero = await addRole('Cajero');
      await give(u.id, vendedor);

      await assign.execute({ organizationId: orgId, userId: u.id, roleIds: [vendedor.id, cajero.id, cajero.id] });

      expect((await rolesOf(u.id)).sort()).toEqual([vendedor.id, cajero.id].sort());
      expect(eventsOf('identity.user.role_assigned')).toHaveLength(1);
    });

    it('un rol de OTRA organización no se puede asignar', async () => {
      const u = await addUser();
      const ajeno = Role.createForOrg({ organizationId: 'org-2', name: 'Vendedor' });
      await uow.roles.save(ajeno);

      await expect(assign.execute({ organizationId: orgId, userId: u.id, roleIds: [ajeno.id] })).rejects.toThrow(RoleNotFoundError);
      expect(await rolesOf(u.id)).toEqual([]);
    });

    it('a alguien que no es de la organización no se le asignan roles', async () => {
      const fuera = User.create({ email: 'fuera@test.com' });
      await uow.users.save(fuera);
      const vendedor = await addRole('Vendedor');
      await expect(assign.execute({ organizationId: orgId, userId: fuera.id, roleIds: [vendedor.id] })).rejects.toThrow(NotOrganizationMemberError);
    });
  });

  describe('quitar', () => {
    it('quita el rol, avisa con un evento y sube la versión de permisos', async () => {
      const u = await addUser();
      const vendedor = await addRole('Vendedor');
      const lectura = await addRole('Solo lectura');
      await give(u.id, vendedor);
      await give(u.id, lectura);
      const antes = (await uow.users.findById(u.id))!.permissionsVersion;

      await remove.execute({ organizationId: orgId, userId: u.id, roleId: lectura.id });

      expect(await rolesOf(u.id)).toEqual([vendedor.id]);
      expect(eventsOf('identity.user.role_removed')).toEqual([
        expect.objectContaining({ aggregateId: u.id, payload: { userId: u.id, organizationId: orgId, roleId: lectura.id } }),
      ]);
      expect((await uow.users.findById(u.id))!.permissionsVersion).toBeGreaterThan(antes);
    });

    it('quitar un rol que no tiene es un no-op', async () => {
      const u = await addUser();
      const vendedor = await addRole('Vendedor');
      const lectura = await addRole('Solo lectura');
      await give(u.id, vendedor);

      await remove.execute({ organizationId: orgId, userId: u.id, roleId: lectura.id });

      expect(await rolesOf(u.id)).toEqual([vendedor.id]);
      expect(eventsOf('identity.user.role_removed')).toHaveLength(0);
    });

    it('no deja al usuario sin ningún rol (para eso está deshabilitar)', async () => {
      const u = await addUser();
      const vendedor = await addRole('Vendedor');
      await give(u.id, vendedor);

      await expect(remove.execute({ organizationId: orgId, userId: u.id, roleId: vendedor.id })).rejects.toThrow(UserMustKeepRoleError);
      expect(await rolesOf(u.id)).toEqual([vendedor.id]);
    });

    it('no le quita «Administrador» al último administrador activo', async () => {
      const u = await addUser();
      const admin = await addRole('Administrador');
      const vendedor = await addRole('Vendedor');
      await give(u.id, admin);
      await give(u.id, vendedor);

      await expect(remove.execute({ organizationId: orgId, userId: u.id, roleId: admin.id })).rejects.toThrow(LastAdminRemovalError);
      expect((await rolesOf(u.id)).sort()).toEqual([admin.id, vendedor.id].sort());
    });

    it('sí se lo quita si queda OTRO administrador activo', async () => {
      const u = await addUser();
      const otro = await addUser();
      const admin = await addRole('Administrador');
      const vendedor = await addRole('Vendedor');
      await give(u.id, admin);
      await give(u.id, vendedor);
      await give(otro.id, admin);

      await remove.execute({ organizationId: orgId, userId: u.id, roleId: admin.id });
      expect(await rolesOf(u.id)).toEqual([vendedor.id]);
    });

    it('un administrador deshabilitado no cuenta como respaldo', async () => {
      const u = await addUser();
      const inactivo = await addUser();
      const m = (await uow.memberships.find(inactivo.id, orgId))!;
      m.disable();
      await uow.memberships.save(m);
      const admin = await addRole('Administrador');
      const vendedor = await addRole('Vendedor');
      await give(u.id, admin);
      await give(u.id, vendedor);
      await give(inactivo.id, admin);

      await expect(remove.execute({ organizationId: orgId, userId: u.id, roleId: admin.id })).rejects.toThrow(LastAdminRemovalError);
    });

    it('errores claros: usuario inexistente, no miembro, rol inexistente o de otra organización', async () => {
      const u = await addUser();
      const vendedor = await addRole('Vendedor');
      await give(u.id, vendedor);
      const fuera = User.create({ email: 'fuera@test.com' });
      await uow.users.save(fuera);
      const ajeno = Role.createForOrg({ organizationId: 'org-2', name: 'Vendedor' });
      await uow.roles.save(ajeno);

      await expect(remove.execute({ organizationId: orgId, userId: 'nadie', roleId: vendedor.id })).rejects.toThrow(UserNotFoundError);
      await expect(remove.execute({ organizationId: orgId, userId: fuera.id, roleId: vendedor.id })).rejects.toThrow(NotOrganizationMemberError);
      await expect(remove.execute({ organizationId: orgId, userId: u.id, roleId: 'no-existe' })).rejects.toThrow(RoleNotFoundError);
      await expect(remove.execute({ organizationId: orgId, userId: u.id, roleId: ajeno.id })).rejects.toThrow(RoleNotFoundError);
    });
  });
});
