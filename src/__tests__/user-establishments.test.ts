import { describe, it, expect, beforeEach } from 'vitest';
import { ListUsersUseCase } from '../application/use-cases/list-users';
import { InviteUserUseCase } from '../application/use-cases/invite-user';
import { UpdateUserEstablishmentsUseCase } from '../application/use-cases/update-user-establishments';
import { Role, User, Membership, UserRole, UserEstablishment } from '../domain/rbac';
import { InMemoryUnitOfWork } from './helpers';

describe('user_establishments (Fase 2)', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000';
  const establishmentA = '550e8400-e29b-41d4-a716-446655440001';
  const establishmentB = '550e8400-e29b-41d4-a716-446655440002';

  let uow: InMemoryUnitOfWork;
  let listUsers: ListUsersUseCase;
  let inviteUser: InviteUserUseCase;
  let updateUserEstablishments: UpdateUserEstablishmentsUseCase;
  let adminRoleId: string;

  beforeEach(async () => {
    uow = new InMemoryUnitOfWork();
    listUsers = new ListUsersUseCase(uow.users, uow.userRoles, uow.roles, uow.organizations, uow.credentials, uow.userEstablishments);
    inviteUser = new InviteUserUseCase(uow, { generateInviteToken: () => 'http://localhost:5173/accept-invite?token=mock' });
    updateUserEstablishments = new UpdateUserEstablishmentsUseCase(uow);

    const org = Role.createForOrg({ organizationId: orgId, name: 'Administrador', isSystem: true });
    await uow.roles.save(org);
    adminRoleId = org.id;
  });

  async function addMember(userId: string): Promise<void> {
    await uow.memberships.save(Membership.create({ userId, organizationId: orgId, status: 'active' }));
    await uow.userRoles.assign(UserRole.assign({ userId, organizationId: orgId, roleId: adminRoleId }));
  }

  it('listUsers incluye establishmentIds por usuario', async () => {
    const user = User.create({ id: 'u-1', email: 'a@test.com' });
    await uow.users.save(user);
    await addMember(user.id);
    await uow.userEstablishments.replaceForUser(user.id, [establishmentA]);

    const items = await listUsers.execute(orgId);
    expect(items[0].establishmentIds).toEqual([establishmentA]);
  });

  it('listUsers filtra por establishmentId', async () => {
    const userA = User.create({ id: 'u-a', email: 'a@test.com' });
    const userB = User.create({ id: 'u-b', email: 'b@test.com' });
    await uow.users.save(userA);
    await uow.users.save(userB);
    await addMember(userA.id);
    await addMember(userB.id);
    await uow.userEstablishments.replaceForUser(userA.id, [establishmentA]);
    await uow.userEstablishments.replaceForUser(userB.id, [establishmentB]);

    const items = await listUsers.execute(orgId, false, establishmentA);
    expect(items.map((i) => i.email)).toEqual(['a@test.com']);
  });

  it('listUsers sin filtro devuelve todos, con sus asignaciones', async () => {
    const userA = User.create({ id: 'u-c', email: 'c@test.com' });
    const userB = User.create({ id: 'u-d', email: 'd@test.com' });
    await uow.users.save(userA);
    await uow.users.save(userB);
    await addMember(userA.id);
    await addMember(userB.id);
    await uow.userEstablishments.replaceForUser(userA.id, [establishmentA]);

    const items = await listUsers.execute(orgId);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.email === 'c@test.com')!.establishmentIds).toEqual([establishmentA]);
    expect(items.find((i) => i.email === 'd@test.com')!.establishmentIds).toEqual([]);
  });

  it('invite asigna los establecimientos enviados', async () => {
    const { userId } = await inviteUser.execute({
      organizationId: orgId,
      email: 'invited@test.com',
      roleIds: [adminRoleId],
      establishmentIds: [establishmentA],
    });

    const assignments = await uow.userEstablishments.listByUser(userId);
    expect(assignments.map((a) => a.establishmentId)).toEqual([establishmentA]);
  });

  it('invite sin establishmentIds deja al usuario sin asignaciones', async () => {
    const { userId } = await inviteUser.execute({
      organizationId: orgId,
      email: 'invited2@test.com',
      roleIds: [adminRoleId],
    });

    expect(await uow.userEstablishments.listByUser(userId)).toHaveLength(0);
  });

  it('updateUserEstablishments reemplaza las asignaciones anteriores', async () => {
    const user = User.create({ id: 'u-upd', email: 'upd@test.com' });
    await uow.users.save(user);
    await addMember(user.id);
    await uow.userEstablishments.replaceForUser(user.id, [establishmentA]);

    await updateUserEstablishments.execute({
      organizationId: orgId,
      userId: user.id,
      establishmentIds: [establishmentB],
    });

    const assignments = await uow.userEstablishments.listByUser(user.id);
    expect(assignments.map((a) => a.establishmentId)).toEqual([establishmentB]);
  });

  it('updateUserEstablishments acepta lista vacía (quitar todos)', async () => {
    const user = User.create({ id: 'u-empty', email: 'empty@test.com' });
    await uow.users.save(user);
    await addMember(user.id);
    await uow.userEstablishments.replaceForUser(user.id, [establishmentA, establishmentB]);

    await updateUserEstablishments.execute({
      organizationId: orgId,
      userId: user.id,
      establishmentIds: [],
    });

    expect(await uow.userEstablishments.listByUser(user.id)).toHaveLength(0);
  });

  it('updateUserEstablishments incrementa permissionsVersion', async () => {
    const user = User.create({ id: 'u-pv', email: 'pv@test.com' });
    await uow.users.save(user);
    await addMember(user.id);

    await updateUserEstablishments.execute({
      organizationId: orgId,
      userId: user.id,
      establishmentIds: [establishmentA],
    });

    expect(user.permissionsVersion).toBe(1);
  });

  it('UserEstablishment.assign y fromPersistence preservan el id', () => {
    const ue = UserEstablishment.assign({ userId: 'u', establishmentId: establishmentA });
    const persisted = ue.toPersistence();
    const restored = UserEstablishment.fromPersistence(persisted);
    expect(restored.id).toBe(ue.id);
    expect(restored.userId).toBe('u');
    expect(restored.establishmentId).toBe(establishmentA);
  });
});
