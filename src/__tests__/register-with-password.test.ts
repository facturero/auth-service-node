import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RegisterWithPasswordUseCase } from '../application/use-cases/register-with-password';
import { SeedOrganizationRolesUseCase } from '../application/use-cases/seed-organization-roles';
import { InMemoryUnitOfWork, MockAccessContextResolver, MockPasswordHasher, MockTokenService } from './helpers';
import { EmailAlreadyExistsError, IdentificationAlreadyExistsError } from '../domain/errors';
import { Email } from '../domain/value-objects';
import { Credential } from '../domain/entities';
import { Role } from '../domain/rbac';

describe('RegisterWithPasswordUseCase', () => {
  let uow: InMemoryUnitOfWork;
  let hasher: MockPasswordHasher;
  let tokenService: MockTokenService;
  let accessContext: MockAccessContextResolver;
  let seedOrg: SeedOrganizationRolesUseCase;
  let useCase: RegisterWithPasswordUseCase;

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    hasher = new MockPasswordHasher();
    tokenService = new MockTokenService();
    accessContext = new MockAccessContextResolver();
    seedOrg = new SeedOrganizationRolesUseCase(uow);
    useCase = new RegisterWithPasswordUseCase(uow, hasher, tokenService, accessContext, seedOrg);
  });

  it('registers a new user and returns a session', async () => {
    const result = await useCase.execute({
      email: 'newuser@test.com',
      password: 'SecurePass1',
      identification: '12345678',
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBe(900);
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBe('newuser@test.com');
    expect(result.user.authProvider).toBe('password');
    expect(result.isNewUser).toBeUndefined();
  });

  it('persists the credential in the repository', async () => {
    await useCase.execute({
      email: 'persist@test.com',
      password: 'SecurePass1',
      identification: '23456789',
    });

    const saved = await uow.credentials.findByEmail('persist@test.com');
    expect(saved).not.toBeNull();
    expect(saved!.email).toBe('persist@test.com');
    expect(saved!.hasPassword()).toBe(true);
  });

  it('adds a domain event to the outbox', async () => {
    await useCase.execute({
      email: 'event@test.com',
      password: 'SecurePass1',
      identification: '34567890',
    });

    expect(uow.outbox.events).toHaveLength(1);
    expect(uow.outbox.events[0].type).toBe('identity.user.created');
    expect(uow.outbox.events[0].payload.email).toBe('event@test.com');
    expect(uow.outbox.events[0].payload.userId).toBeTruthy();
  });

  it('throws EmailAlreadyExistsError if email is taken', async () => {
    const email = Email.create('existing@test.com');
    const credential = Credential.createWithPassword({
      email,
      passwordHash: 'hash',
    });
    await uow.credentials.save(credential);

    await expect(
      useCase.execute({
        email: 'existing@test.com',
        password: 'SecurePass1',
        identification: '45678901',
      }),
    ).rejects.toThrow(EmailAlreadyExistsError);
  });

  it('throws IdentificationAlreadyExistsError if identification is taken', async () => {
    await useCase.execute({
      email: 'first@test.com',
      password: 'SecurePass1',
      identification: '11111111',
    });

    await expect(
      useCase.execute({
        email: 'second@test.com',
        password: 'SecurePass1',
        identification: '11111111',
      }),
    ).rejects.toThrow(IdentificationAlreadyExistsError);
  });

  it('hashes the password before storing', async () => {
    const spy = vi.spyOn(hasher, 'hash');

    await useCase.execute({
      email: 'hashcheck@test.com',
      password: 'myPassword',
      identification: '56789012',
    });

    expect(spy).toHaveBeenCalledWith('myPassword');

    const saved = await uow.credentials.findByEmail('hashcheck@test.com');
    expect(saved!.passwordHash).toContain('hashed:');
  });

  it('emits a session with correct user summary', async () => {
    const result = await useCase.execute({
      email: 'summary@test.com',
      password: 'SecurePass1',
      identification: '67890123',
    });

    expect(result.user).toEqual({
      id: expect.any(String),
      email: 'summary@test.com',
      emailVerified: false,
      authProvider: 'password',
    });
  });

  it('persists the refresh token', async () => {
    const session = await useCase.execute({
      email: 'rt@test.com',
      password: 'SecurePass1',
      identification: '78901234',
    });

    const hash = tokenService.hashRefreshToken(session.refreshToken);
    const saved = await uow.refreshTokens.findByHash(hash);
    expect(saved).not.toBeNull();
  });

  it('creates a minimal organization and admin membership for the founder', async () => {
    // Pre-seed template roles so seedOrgRoles works
    const adminTemplate = Role.template({ name: 'Administrador', description: null });
    uow.roles.save(adminTemplate);

    const result = await useCase.execute({
      email: 'orgtest@test.com',
      password: 'SecurePass1',
      identification: '89012345',
    });

    expect(result.organizationId).toBeTruthy();

    // auth solo guarda el read-model mínimo (id); el perfil (nombre/RUC) es de organization-service.
    const org = await uow.organizations.findById(result.organizationId!);
    expect(org).not.toBeNull();
    expect(org!.id).toBe(result.organizationId);

    const memberships = await uow.memberships.listActiveByUser(result.user.id);
    expect(memberships.length).toBeGreaterThan(0);
    expect(memberships[0].organizationId).toBe(result.organizationId);
  });
});
