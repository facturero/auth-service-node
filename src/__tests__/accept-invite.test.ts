import { describe, it, expect, beforeEach } from 'vitest';
import { AcceptInviteUseCase } from '../application/use-cases/accept-invite';
import { DisableUserUseCase } from '../application/use-cases/disable-user';
import { InviteUserUseCase } from '../application/use-cases/invite-user';
import { InMemoryUnitOfWork, MockAccessContextResolver, MockPasswordHasher, MockTokenService } from './helpers';
import { User, Organization, Role } from '../domain/rbac';
import { Credential } from '../domain/entities';
import { AccountDisabledError, CredentialAlreadyExistsError, MembershipNotInvitedError } from '../domain/errors';

// Invitar -> deshabilitar -> habilitar -> aceptar. Antes de corregir disable-user, habilitar a alguien que nunca aceptó
// pasaba su membresía a "activo": la invitación daba MEMBERSHIP_NOT_INVITED y el restablecimiento "no tiene una
// contraseña configurada", y la cuenta quedaba sin salida (visto el 2026-10-05).
describe('invitaciones: deshabilitar / habilitar / aceptar', () => {
  const orgId = 'org-1';
  const ownerId = 'owner-1';
  let uow: InMemoryUnitOfWork;
  let invite: InviteUserUseCase;
  let disable: DisableUserUseCase;
  let accept: AcceptInviteUseCase;
  let vendedorRoleId: string;

  const tokenFor = (userId: string) => Buffer.from(JSON.stringify({ uid: userId, oid: orgId })).toString('base64url');

  beforeEach(async () => {
    uow = new InMemoryUnitOfWork();
    invite = new InviteUserUseCase(uow, { generateInviteToken: () => 'http://localhost/accept-invite?token=mock' });
    disable = new DisableUserUseCase(uow);
    accept = new AcceptInviteUseCase(uow, new MockPasswordHasher(), new MockTokenService(), new MockAccessContextResolver(), uow.refreshTokens);
    const owner = User.create({ id: ownerId, email: 'owner@test.com' });
    await uow.users.save(owner);
    await uow.organizations.save(Organization.create({ id: orgId, ownerId }));
    const role = Role.createForOrg({ organizationId: orgId, name: 'Vendedor' });
    await uow.roles.save(role);
    vendedorRoleId = role.id;
  });

  async function invitar(email = 'nuevo@test.com'): Promise<string> {
    const { userId } = await invite.execute({ organizationId: orgId, email, roleIds: [vendedorRoleId] });
    return userId;
  }
  const membership = async (userId: string) => (await uow.memberships.find(userId, orgId))!;
  const toggle = (userId: string) => disable.execute({ organizationId: orgId, userId, actorId: ownerId });

  it('flujo normal: el invitado acepta, queda con credencial y membresía activa', async () => {
    const userId = await invitar();
    expect((await membership(userId)).status).toBe('invited');

    await accept.execute({ token: tokenFor(userId), password: 'Clave-123456' });

    expect((await membership(userId)).status).toBe('active');
    expect(await uow.credentials.findByUserId(userId)).not.toBeNull();
  });

  it('deshabilitar y habilitar a un invitado lo deja INVITADO (no activo) y su invitación se puede aceptar', async () => {
    const userId = await invitar();

    await toggle(userId); // deshabilitar
    expect((await uow.users.findById(userId))!.isActive()).toBe(false);
    expect((await membership(userId)).status).toBe('disabled');

    await toggle(userId); // habilitar
    expect((await uow.users.findById(userId))!.isActive()).toBe(true);
    expect((await membership(userId)).status).toBe('invited');

    await accept.execute({ token: tokenFor(userId), password: 'Clave-123456' });
    expect((await membership(userId)).status).toBe('active');
    expect(await uow.credentials.findByUserId(userId)).not.toBeNull();
  });

  it('varios ciclos de deshabilitar/habilitar no cambian nada', async () => {
    const userId = await invitar();
    for (let i = 0; i < 3; i++) {
      await toggle(userId);
      await toggle(userId);
    }
    expect((await membership(userId)).status).toBe('invited');
  });

  it('quien YA aceptó (tiene credencial) vuelve a "activo" al habilitarlo', async () => {
    const userId = await invitar();
    await accept.execute({ token: tokenFor(userId), password: 'Clave-123456' });

    await toggle(userId);
    expect((await membership(userId)).status).toBe('disabled');
    await toggle(userId);
    expect((await membership(userId)).status).toBe('active');
  });

  it('un usuario deshabilitado no puede aceptar su invitación', async () => {
    const userId = await invitar();
    await toggle(userId);
    await expect(accept.execute({ token: tokenFor(userId), password: 'Clave-123456' })).rejects.toThrow(AccountDisabledError);
    expect(await uow.credentials.findByUserId(userId)).toBeNull();
  });

  it('RECUPERA las cuentas que ya quedaron bloqueadas (membresía activa sin credencial) con su invitación original', async () => {
    // Estado que dejaba el bug: usuario activo, membresía "activa", nadie puso contraseña.
    const userId = await invitar();
    const m = await membership(userId);
    m.activate();
    await uow.memberships.save(m);

    await accept.execute({ token: tokenFor(userId), password: 'Clave-123456' });

    expect((await membership(userId)).status).toBe('active');
    expect(await uow.credentials.findByUserId(userId)).not.toBeNull();
  });

  it('no acepta si ya hay credencial', async () => {
    const userId = await invitar();
    const user = (await uow.users.findById(userId))!;
    await uow.credentials.save(Credential.create({ userId, email: user.email, passwordHash: 'x', authProvider: 'password', emailVerified: true }));
    await expect(accept.execute({ token: tokenFor(userId), password: 'Clave-123456' })).rejects.toThrow(CredentialAlreadyExistsError);
  });

  it('no acepta si la membresía está deshabilitada pero el usuario figura activo (estado incoherente)', async () => {
    const userId = await invitar();
    const m = await membership(userId);
    m.disable();
    await uow.memberships.save(m);
    await expect(accept.execute({ token: tokenFor(userId), password: 'Clave-123456' })).rejects.toThrow(MembershipNotInvitedError);
  });

  it('no acepta una invitación de otra organización', async () => {
    const userId = await invitar();
    const token = Buffer.from(JSON.stringify({ uid: userId, oid: 'otra-org' })).toString('base64url');
    await expect(accept.execute({ token, password: 'Clave-123456' })).rejects.toThrow(MembershipNotInvitedError);
  });
});
