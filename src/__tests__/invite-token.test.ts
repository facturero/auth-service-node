import { describe, it, expect, beforeEach } from 'vitest';
import { SignedInviteTokenService } from '../infrastructure/security/invite-token-service';
import { AcceptInviteUseCase } from '../application/use-cases/accept-invite';
import { InviteUserUseCase } from '../application/use-cases/invite-user';
import { DisableUserUseCase } from '../application/use-cases/disable-user';
import { InMemoryUnitOfWork, MockAccessContextResolver, MockPasswordHasher, MockTokenService } from './helpers';
import { InvalidInviteTokenError, UserAlreadyInvitedError } from '../domain/errors';
import { User, Organization, Role } from '../domain/rbac';

// El token de invitación era el JSON {uid, oid} en base64, sin firma ni caducidad: quien conociera el id de un usuario y el
// de su organización podía fabricarlo y ponerle contraseña a una cuenta pendiente. Ahora va firmado (HMAC) y caduca.
const FRONT = 'http://localhost:5173';
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('SignedInviteTokenService', () => {
  let clock = 1_800_000_000_000;
  const svc = (over: Partial<ConstructorParameters<typeof SignedInviteTokenService>[0]> = {}) =>
    new SignedInviteTokenService({ frontendUrl: FRONT, secret: 'secreto-1', now: () => clock, ...over });

  beforeEach(() => {
    clock = 1_800_000_000_000;
  });

  it('un token firmado se lee de vuelta', () => {
    const s = svc();
    const token = tokenOf(s.generateInviteToken({ userId: 'u1', email: 'a@b.c', organizationId: 'o1' }));
    expect(token.startsWith('v2.')).toBe(true);
    expect(s.read(token)).toEqual({ userId: 'u1', organizationId: 'o1' });
  });

  it('el enlace apunta al frontend y no contiene los ids en claro como único contenido', () => {
    const url = svc().generateInviteToken({ userId: 'u1', email: 'a@b.c', organizationId: 'o1' });
    expect(url.startsWith(`${FRONT}/accept-invite?token=v2.`)).toBe(true);
  });

  it('un token alterado se rechaza (cambiar el usuario o la organización)', () => {
    const s = svc();
    const token = tokenOf(s.generateInviteToken({ userId: 'u1', email: 'a@b.c', organizationId: 'o1' }));
    const [v, , sig] = token.split('.');
    const forgedBody = b64({ uid: 'u-victima', oid: 'o1', exp: Math.floor(clock / 1000) + 3600 });
    expect(() => s.read(`${v}.${forgedBody}.${sig}`)).toThrow(InvalidInviteTokenError);
  });

  it('un token fabricado sin la clave se rechaza', () => {
    const body = b64({ uid: 'u1', oid: 'o1', exp: Math.floor(clock / 1000) + 3600 });
    expect(() => svc().read(`v2.${body}.firma-inventada`)).toThrow(InvalidInviteTokenError);
    expect(() => svc().read(`v2.${body}.`)).toThrow(InvalidInviteTokenError);
    expect(() => svc().read('v2.solo-dos-partes')).toThrow(InvalidInviteTokenError);
  });

  it('un token firmado con OTRA clave se rechaza', () => {
    const token = tokenOf(svc({ secret: 'otro-secreto' }).generateInviteToken({ userId: 'u1', email: 'a@b.c', organizationId: 'o1' }));
    expect(() => svc().read(token)).toThrow(InvalidInviteTokenError);
  });

  it('caduca: pasada su vigencia se rechaza con un mensaje claro', () => {
    const s = svc({ ttlSeconds: 3600 });
    const token = tokenOf(s.generateInviteToken({ userId: 'u1', email: 'a@b.c', organizationId: 'o1' }));
    clock += 3599 * 1000;
    expect(s.read(token).userId).toBe('u1');
    clock += 2 * 1000;
    expect(() => s.read(token)).toThrow(/caducó/);
  });

  it('por defecto vale 7 días', () => {
    const s = svc();
    const token = tokenOf(s.generateInviteToken({ userId: 'u1', email: 'a@b.c', organizationId: 'o1' }));
    clock += 7 * 24 * 3600 * 1000 - 1000;
    expect(s.read(token).userId).toBe('u1');
    clock += 2000;
    expect(() => s.read(token)).toThrow(InvalidInviteTokenError);
  });

  it('sin secreto propio deriva la clave de la clave privada JWT, y otra clave privada no sirve', () => {
    const a = svc({ secret: undefined, jwtPrivateKey: 'PEM-A' });
    const token = tokenOf(a.generateInviteToken({ userId: 'u1', email: 'a@b.c', organizationId: 'o1' }));
    expect(a.read(token).userId).toBe('u1');
    expect(() => svc({ secret: undefined, jwtPrivateKey: 'PEM-B' }).read(token)).toThrow(InvalidInviteTokenError);
  });

  it('sin secreto ni clave privada no arranca', () => {
    expect(() => new SignedInviteTokenService({ frontendUrl: FRONT })).toThrow();
  });

  describe('enlaces viejos sin firma (transición)', () => {
    const legacy = b64({ uid: 'u1', oid: 'o1' });

    it('con allowLegacy se aceptan y se avisa de cada uso', () => {
      const seen: string[] = [];
      const s = svc({ allowLegacy: true, onLegacyToken: (u) => seen.push(u) });
      expect(s.read(legacy)).toEqual({ userId: 'u1', organizationId: 'o1' });
      expect(seen).toEqual(['u1']);
    });

    it('sin allowLegacy se rechazan: ya nadie puede fabricar uno', () => {
      expect(() => svc({ allowLegacy: false }).read(legacy)).toThrow(/versión anterior/);
    });

    it('un legacy mal formado se rechaza aunque se acepten', () => {
      expect(() => svc({ allowLegacy: true }).read('no-es-base64-json')).toThrow(InvalidInviteTokenError);
      expect(() => svc({ allowLegacy: true }).read(b64({ uid: 'u1' }))).toThrow(InvalidInviteTokenError);
    });
  });
});

describe('aceptar una invitación con token firmado, y reenviarla', () => {
  const orgId = 'org-1';
  let uow: InMemoryUnitOfWork;
  let signer: SignedInviteTokenService;
  let invite: InviteUserUseCase;
  let accept: AcceptInviteUseCase;
  let roleId: string;
  let clock = 1_800_000_000_000;

  beforeEach(async () => {
    clock = 1_800_000_000_000;
    uow = new InMemoryUnitOfWork();
    signer = new SignedInviteTokenService({ frontendUrl: FRONT, secret: 's', now: () => clock });
    invite = new InviteUserUseCase(uow, signer);
    accept = new AcceptInviteUseCase(uow, new MockPasswordHasher(), new MockTokenService(), new MockAccessContextResolver(), uow.refreshTokens, signer);
    const owner = User.create({ id: 'owner', email: 'o@test.com' });
    await uow.users.save(owner);
    await uow.organizations.save(Organization.create({ id: orgId, ownerId: 'owner' }));
    const role = Role.createForOrg({ organizationId: orgId, name: 'Vendedor' });
    await uow.roles.save(role);
    roleId = role.id;
  });

  const lastInviteToken = () => {
    const ev = [...uow.outbox.events].reverse().find((e) => e.type === 'identity.user.invited')!;
    return tokenOf((ev.payload as { inviteUrl: string }).inviteUrl);
  };

  it('el flujo normal funciona con el enlace que se envía por correo', async () => {
    const { userId } = await invite.execute({ organizationId: orgId, email: 'n@test.com', roleIds: [roleId] });
    await accept.execute({ token: lastInviteToken(), password: 'Clave-123456' });
    expect(await uow.credentials.findByUserId(userId)).not.toBeNull();
  });

  it('un token fabricado con solo los ids (el ataque) ya NO sirve', async () => {
    const { userId } = await invite.execute({ organizationId: orgId, email: 'n@test.com', roleIds: [roleId] });
    const forged = b64({ uid: userId, oid: orgId }); // formato viejo
    const strict = new SignedInviteTokenService({ frontendUrl: FRONT, secret: 's', allowLegacy: false, now: () => clock });
    const acceptStrict = new AcceptInviteUseCase(uow, new MockPasswordHasher(), new MockTokenService(), new MockAccessContextResolver(), uow.refreshTokens, strict);
    await expect(acceptStrict.execute({ token: forged, password: 'Clave-123456' })).rejects.toThrow(InvalidInviteTokenError);
    expect(await uow.credentials.findByUserId(userId)).toBeNull();
  });

  it('una invitación caducada no se puede aceptar, y reenviarla da un enlace nuevo que sí funciona', async () => {
    const { userId } = await invite.execute({ organizationId: orgId, email: 'n@test.com', roleIds: [roleId] });
    const viejo = lastInviteToken();
    clock += 8 * 24 * 3600 * 1000;
    await expect(accept.execute({ token: viejo, password: 'Clave-123456' })).rejects.toThrow(/caducó/);

    const again = await invite.execute({ organizationId: orgId, email: 'n@test.com', roleIds: [roleId] });
    expect(again.userId).toBe(userId);
    const nuevo = lastInviteToken();
    expect(nuevo).not.toBe(viejo);
    await accept.execute({ token: nuevo, password: 'Clave-123456' });
    expect(await uow.credentials.findByUserId(userId)).not.toBeNull();
  });

  it('reenviar no duplica el rol ni la membresía', async () => {
    const { userId } = await invite.execute({ organizationId: orgId, email: 'n@test.com', roleIds: [roleId] });
    await invite.execute({ organizationId: orgId, email: 'n@test.com', roleIds: [roleId] });
    expect((await uow.userRoles.listByUserAndOrg(userId, orgId)).length).toBe(1);
    expect((await uow.memberships.find(userId, orgId))!.status).toBe('invited');
  });

  it('invitar a quien YA aceptó sigue dando 409', async () => {
    await invite.execute({ organizationId: orgId, email: 'n@test.com', roleIds: [roleId] });
    await accept.execute({ token: lastInviteToken(), password: 'Clave-123456' });
    await expect(invite.execute({ organizationId: orgId, email: 'n@test.com', roleIds: [roleId] })).rejects.toThrow(UserAlreadyInvitedError);
  });

  it('invitar a un usuario deshabilitado sigue dando 409 (primero hay que habilitarlo)', async () => {
    const { userId } = await invite.execute({ organizationId: orgId, email: 'n@test.com', roleIds: [roleId] });
    await new DisableUserUseCase(uow).execute({ organizationId: orgId, userId, actorId: 'owner' });
    await expect(invite.execute({ organizationId: orgId, email: 'n@test.com', roleIds: [roleId] })).rejects.toThrow(UserAlreadyInvitedError);
  });
});
