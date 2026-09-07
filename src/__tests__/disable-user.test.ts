import { describe, it, expect, beforeEach } from 'vitest';
import { DisableUserUseCase } from '../application/use-cases/disable-user';
import { InMemoryUnitOfWork } from './helpers';
import { User, Organization, Role, Membership, UserRole } from '../domain/rbac';
import { LastAdminRemovalError, ForbiddenError } from '../domain/errors';

describe('DisableUserUseCase', () => {
  let uow: InMemoryUnitOfWork;
  let useCase: DisableUserUseCase;

  const orgId = 'org-1';
  const adminRoleName = 'Administrador';

  function addUser(status: 'active' | 'disabled' = 'active'): User {
    const user = User.create({ email: `u-${Math.random()}@test.com` });
    if (status === 'disabled') user.disable();
    uow.users.save(user);
    const membership = Membership.create({ userId: user.id, organizationId: orgId });
    if (status === 'disabled') membership.disable();
    uow.memberships.save(membership);
    return user;
  }

  function addAdminRole(): Role {
    const role = Role.createForOrg({ organizationId: orgId, name: adminRoleName });
    uow.roles.save(role);
    return role;
  }

  function assignRole(userId: string, role: Role): void {
    uow.userRoles.assign(UserRole.assign({ userId, organizationId: orgId, roleId: role.id }));
  }

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    useCase = new DisableUserUseCase(uow);
    const owner = User.create({ email: 'owner@test.com' });
    uow.users.save(owner);
    uow.organizations.save(Organization.create({ id: orgId, ownerId: owner.id }));
  });

  it('blocks disabling the last non-owner admin (would leave org without admin)', async () => {
    const soleAdmin = addUser();
    const adminRole = addAdminRole();
    assignRole(soleAdmin.id, adminRole);

    await expect(
      useCase.execute({ organizationId: orgId, userId: soleAdmin.id, actorId: 'actor' }),
    ).rejects.toThrow(LastAdminRemovalError);
    // Nada debe haber cambiado de estado: sigue activo.
    expect((await uow.users.findById(soleAdmin.id))!.isActive()).toBe(true);
    expect((await uow.memberships.find(soleAdmin.id, orgId))!.isActive()).toBe(true);
  });

  it('allows disabling an admin when ANOTHER non-owner admin stays active', async () => {
    const target = addUser();
    const other = addUser();
    const adminRole = addAdminRole();
    assignRole(target.id, adminRole);
    assignRole(other.id, adminRole);

    await useCase.execute({ organizationId: orgId, userId: target.id, actorId: 'actor' });

    expect((await uow.users.findById(target.id))!.isActive()).toBe(false);
    expect(uow.outbox.events.some((e) => e.type === 'identity.user.disabled')).toBe(true);
  });

  it('does NOT count a disabled admin as backstop', async () => {
    const target = addUser();
    const disabled = addUser('disabled');
    const adminRole = addAdminRole();
    assignRole(target.id, adminRole);
    assignRole(disabled.id, adminRole);

    await expect(
      useCase.execute({ organizationId: orgId, userId: target.id, actorId: 'actor' }),
    ).rejects.toThrow(LastAdminRemovalError);
  });

  it('allows disabling a non-admin user', async () => {
    const nonAdmin = addUser();
    addAdminRole(); // Nadie tiene el rol; no debe afectar a usuarios sin admin.

    await useCase.execute({ organizationId: orgId, userId: nonAdmin.id, actorId: 'actor' });

    expect((await uow.users.findById(nonAdmin.id))!.isActive()).toBe(false);
  });

  it('does NOT count the OWNER as another admin backstop', async () => {
    const target = addUser();
    const adminRole = addAdminRole();
    assignRole(target.id, adminRole);
    // El owner también tiene rol Administrador: aún así no cuenta, porque el
    // owner está protegido por separado y no puede "hacer de admin" si es el
    // único que queda en la org (siempre puede ser desbloqueado vía otro canal).
    const ownerId = (await uow.organizations.findById(orgId))!.ownerId!;
    assignRole(ownerId, adminRole);

    await expect(
      useCase.execute({ organizationId: orgId, userId: target.id, actorId: 'actor' }),
    ).rejects.toThrow(LastAdminRemovalError);
  });

  it('blocks disabling yourself', async () => {
    const self = addUser();

    await expect(
      useCase.execute({ organizationId: orgId, userId: self.id, actorId: self.id }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('blocks disabling the organization owner', async () => {
    const org = (await uow.organizations.findById(orgId))!;
    const owner = addUser();
    org.setOwner(owner.id);
    const adminRole = addAdminRole();
    assignRole(owner.id, adminRole);

    await expect(
      useCase.execute({ organizationId: orgId, userId: owner.id, actorId: 'actor' }),
    ).rejects.toThrow(ForbiddenError);
  });
});