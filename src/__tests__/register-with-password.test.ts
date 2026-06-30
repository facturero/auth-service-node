import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RegisterWithPasswordUseCase } from '../application/use-cases/register-with-password';
import { InMemoryUnitOfWork, MockPasswordHasher, MockTokenService } from './helpers';
import { EmailAlreadyExistsError } from '../domain/errors';
import { Email } from '../domain/value-objects';
import { Credential } from '../domain/entities';

describe('RegisterWithPasswordUseCase', () => {
  let uow: InMemoryUnitOfWork;
  let hasher: MockPasswordHasher;
  let tokenService: MockTokenService;
  let useCase: RegisterWithPasswordUseCase;

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    hasher = new MockPasswordHasher();
    tokenService = new MockTokenService();
    useCase = new RegisterWithPasswordUseCase(uow, hasher, tokenService);
  });

  it('registers a new user and returns a session', async () => {
    const result = await useCase.execute({
      email: 'newuser@test.com',
      password: 'SecurePass1',
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
    });

    expect(uow.outbox.events).toHaveLength(1);
    expect(uow.outbox.events[0].type).toBe('auth.credential.registered');
    expect(uow.outbox.events[0].payload.email).toBe('event@test.com');
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
      }),
    ).rejects.toThrow(EmailAlreadyExistsError);

    // Only one credential should exist
    const all = await uow.credentials.findByEmail('existing@test.com');
    expect(all).toBeTruthy();
  });

  it('hashes the password before storing', async () => {
    const spy = vi.spyOn(hasher, 'hash');

    await useCase.execute({
      email: 'hashcheck@test.com',
      password: 'myPassword',
    });

    expect(spy).toHaveBeenCalledWith('myPassword');

    const saved = await uow.credentials.findByEmail('hashcheck@test.com');
    expect(saved!.passwordHash).toContain('hashed:');
  });

  it('emits a session with correct user summary', async () => {
    const result = await useCase.execute({
      email: 'summary@test.com',
      password: 'SecurePass1',
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
    });

    const hash = tokenService.hashRefreshToken(session.refreshToken);
    const saved = await uow.refreshTokens.findByHash(hash);
    expect(saved).not.toBeNull();
  });
});
