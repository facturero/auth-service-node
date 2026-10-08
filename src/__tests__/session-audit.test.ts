import { describe, it, expect, beforeEach } from 'vitest';
import { LoginWithPasswordUseCase } from '../application/use-cases/login-with-password';
import { LogoutUseCase } from '../application/use-cases/logout';
import { SwitchOrganizationUseCase } from '../application/use-cases/switch-organization';
import { SessionAuditor } from '../application/session-audit';
import { AccessContext } from '../application/ports';
import { Credential, RefreshToken } from '../domain/entities';
import { Email } from '../domain/value-objects';
import { Membership } from '../domain/rbac';
import { AccountDisabledError, InvalidCredentialsError } from '../domain/errors';
import {
  InMemoryCredentialRepository,
  InMemoryOutboxRepository,
  InMemoryRefreshTokenRepository,
  InMemoryUnitOfWork,
  MockAccessContextResolver,
  MockPasswordHasher,
  MockTokenService,
} from './helpers';

// Quién entra, quién falla al entrar, quién sale y quién cambia de organización: antes nada de eso dejaba huella.
class OrgAccessContext extends MockAccessContextResolver {
  override async resolve(): Promise<AccessContext> {
    return { orgId: 'org-1', countryCode: 'EC', permissions: [], pv: 0 };
  }
}

describe('eventos de sesión para la bitácora', () => {
  let credentials: InMemoryCredentialRepository;
  let refreshTokens: InMemoryRefreshTokenRepository;
  let outbox: InMemoryOutboxRepository;
  let hasher: MockPasswordHasher;
  let tokenService: MockTokenService;
  let audit: SessionAuditor;

  beforeEach(() => {
    credentials = new InMemoryCredentialRepository();
    refreshTokens = new InMemoryRefreshTokenRepository();
    outbox = new InMemoryOutboxRepository();
    hasher = new MockPasswordHasher();
    tokenService = new MockTokenService();
    audit = new SessionAuditor(outbox);
  });

  async function seedUser(status: 'active' | 'disabled' = 'active'): Promise<Credential> {
    const base = Credential.createWithPassword({
      email: Email.create('ana@empresa.com'),
      passwordHash: await hasher.hash('clave-correcta'),
    });
    const credential =
      status === 'disabled' ? Credential.fromPersistence({ ...base.toPersistence(), status: 'disabled' }) : base;
    await credentials.save(credential);
    return credential;
  }

  describe('login con contraseña', () => {
    const login = () => new LoginWithPasswordUseCase(credentials, refreshTokens, hasher, tokenService, new OrgAccessContext(), audit);

    it('un login correcto publica auth.session.login_succeeded con usuario, organización e IP', async () => {
      const credential = await seedUser();
      await login().execute({ email: 'ana@empresa.com', password: 'clave-correcta', ip: '203.0.113.7', userAgent: 'Chrome' });

      expect(outbox.events).toHaveLength(1);
      const ev = outbox.events[0];
      expect(ev.type).toBe('auth.session.login_succeeded');
      expect(ev.payload).toMatchObject({
        actorId: credential.userId,
        actorEmail: 'ana@empresa.com',
        actorIp: '203.0.113.7',
        organizationId: 'org-1',
        provider: 'password',
      });
    });

    it('una contraseña incorrecta publica login_failed con el motivo, y el error al cliente sigue siendo el mismo', async () => {
      await seedUser();
      await expect(login().execute({ email: 'ana@empresa.com', password: 'mala', ip: '198.51.100.9' })).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );

      const ev = outbox.events[0];
      expect(ev.type).toBe('auth.session.login_failed');
      expect(ev.payload).toMatchObject({ actorEmail: 'ana@empresa.com', actorIp: '198.51.100.9', reason: 'invalid_credentials' });
    });

    it('un intento fallido de una cuenta conocida lleva su organización (aparece en la bitácora de su empresa)', async () => {
      await seedUser();
      await expect(login().execute({ email: 'ana@empresa.com', password: 'mala' })).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(outbox.events[0].payload).toMatchObject({ reason: 'invalid_credentials', organizationId: 'org-1' });
    });

    it('si resolver la organización falla, el login sigue respondiendo lo mismo y el intento se registra', async () => {
      await seedUser();
      const rota = {
        async resolve() {
          throw new Error('db caída');
        },
      };
      const useCase = new LoginWithPasswordUseCase(credentials, refreshTokens, hasher, tokenService, rota, audit);
      await expect(useCase.execute({ email: 'ana@empresa.com', password: 'mala' })).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(outbox.events[0].type).toBe('auth.session.login_failed');
      expect(outbox.events[0].payload.organizationId).toBeUndefined();
    });

    it('un correo que no existe también queda registrado, sin inventar un usuario', async () => {
      await expect(login().execute({ email: 'nadie@empresa.com', password: 'x' })).rejects.toBeInstanceOf(InvalidCredentialsError);

      const ev = outbox.events[0];
      expect(ev.type).toBe('auth.session.login_failed');
      expect(ev.payload.actorId).toBeUndefined();
      expect(ev.payload).toMatchObject({ actorEmail: 'nadie@empresa.com', reason: 'invalid_credentials' });
    });

    it('una cuenta deshabilitada se registra con su propio motivo', async () => {
      await seedUser('disabled');
      await expect(login().execute({ email: 'ana@empresa.com', password: 'clave-correcta' })).rejects.toBeInstanceOf(
        AccountDisabledError,
      );
      expect(outbox.events[0].payload).toMatchObject({ reason: 'account_disabled' });
    });

    it('jamás guarda la contraseña ni los tokens', async () => {
      await seedUser();
      await login().execute({ email: 'ana@empresa.com', password: 'clave-correcta' });
      await expect(login().execute({ email: 'ana@empresa.com', password: 'otra-clave-mala' })).rejects.toThrow();

      const todo = JSON.stringify(outbox.events);
      expect(todo).not.toContain('clave-correcta');
      expect(todo).not.toContain('otra-clave-mala');
      // `provider: 'password'` (el método de acceso) es legítimo; lo que no puede existir es una CLAVE de secreto.
      for (const ev of outbox.events) {
        for (const key of Object.keys(ev.payload)) expect(key).not.toMatch(/password|token|secret/i);
      }
    });

    it('si la bitácora falla, el login no se cae', async () => {
      await seedUser();
      const rota = new SessionAuditor({ add: async () => { throw new Error('db caída'); } });
      const useCase = new LoginWithPasswordUseCase(credentials, refreshTokens, hasher, tokenService, new OrgAccessContext(), rota);

      await expect(useCase.execute({ email: 'ana@empresa.com', password: 'clave-correcta' })).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    });

    it('sin auditor (como en los otros tests) funciona igual', async () => {
      await seedUser();
      const useCase = new LoginWithPasswordUseCase(credentials, refreshTokens, hasher, tokenService, new OrgAccessContext());
      await expect(useCase.execute({ email: 'ana@empresa.com', password: 'clave-correcta' })).resolves.toBeTruthy();
    });
  });

  describe('logout', () => {
    it('cerrar una sesión publica auth.session.logout con quién era, y repetirlo no duplica el aviso', async () => {
      const credential = await seedUser();
      const refresh = tokenService.generateRefreshToken();
      await refreshTokens.save(
        RefreshToken.issue({ credentialId: credential.id, tokenHash: refresh.hash, expiresAt: new Date(Date.now() + 86_400_000) }),
      );
      const useCase = new LogoutUseCase(refreshTokens, tokenService, audit, credentials);

      await useCase.execute({ refreshToken: refresh.token, ip: '203.0.113.7' });
      await useCase.execute({ refreshToken: refresh.token, ip: '203.0.113.7' });

      expect(outbox.events).toHaveLength(1);
      expect(outbox.events[0].type).toBe('auth.session.logout');
      expect(outbox.events[0].payload).toMatchObject({
        actorId: credential.userId,
        actorEmail: 'ana@empresa.com',
        actorIp: '203.0.113.7',
      });
    });

    it('un token que no existe no deja aviso', async () => {
      await new LogoutUseCase(refreshTokens, tokenService, audit, credentials).execute({ refreshToken: 'no-existe' });
      expect(outbox.events).toHaveLength(0);
    });
  });

  describe('cambio de organización', () => {
    it('publica auth.session.org_switched con la organización destino', async () => {
      const uow = new InMemoryUnitOfWork();
      const credential = Credential.createWithPassword({ email: Email.create('ana@empresa.com'), passwordHash: 'h' });
      await uow.credentials.save(credential);
      await uow.memberships.save(Membership.create({ userId: credential.userId, organizationId: 'org-2', status: 'active' }));

      await new SwitchOrganizationUseCase(uow, tokenService, new OrgAccessContext()).execute({
        userId: credential.userId,
        organizationId: 'org-2',
        ip: '203.0.113.7',
      });

      const ev = uow.outbox.events.find((e) => e.type === 'auth.session.org_switched');
      expect(ev?.payload).toMatchObject({ actorId: credential.userId, organizationId: 'org-2', actorIp: '203.0.113.7' });
    });

    it('si no es miembro, no deja aviso', async () => {
      const uow = new InMemoryUnitOfWork();
      const credential = Credential.createWithPassword({ email: Email.create('ana@empresa.com'), passwordHash: 'h' });
      await uow.credentials.save(credential);

      await expect(
        new SwitchOrganizationUseCase(uow, tokenService, new OrgAccessContext()).execute({
          userId: credential.userId,
          organizationId: 'org-9',
        }),
      ).rejects.toThrow();
      expect(uow.outbox.events).toHaveLength(0);
    });
  });

  it('los nombres no empiezan por identity.: el gateway los trataría como cambio de permisos', async () => {
    const credential = await seedUser();
    await new LoginWithPasswordUseCase(credentials, refreshTokens, hasher, tokenService, new OrgAccessContext(), audit).execute({
      email: 'ana@empresa.com',
      password: 'clave-correcta',
    });
    expect(credential).toBeTruthy();
    for (const ev of outbox.events) expect(ev.type.startsWith('identity.')).toBe(false);
    // Y no llevan `userId` en el payload (el gateway lo usa para avisar a ese usuario).
    for (const ev of outbox.events) expect(ev.payload).not.toHaveProperty('userId');
  });
});
