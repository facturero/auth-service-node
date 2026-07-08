import { describe, it, expect, beforeEach } from 'vitest';
import { GetMeUseCase } from '../application/use-cases/get-me';
import { InMemoryCredentialRepository, InMemoryOrganizationRepository, InMemoryUserRepository } from './helpers';
import { Email } from '../domain/value-objects';
import { Credential } from '../domain/entities';
import { UnauthorizedError } from '../domain/errors';

describe('GetMeUseCase', () => {
  let credentials: InMemoryCredentialRepository;
  let users: InMemoryUserRepository;
  let organizations: InMemoryOrganizationRepository;
  let useCase: GetMeUseCase;

  beforeEach(() => {
    credentials = new InMemoryCredentialRepository();
    users = new InMemoryUserRepository();
    organizations = new InMemoryOrganizationRepository();
    useCase = new GetMeUseCase(credentials, users, organizations);
  });

  it('returns user data for active credential', async () => {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({
      email,
      passwordHash: 'hash',
    });
    await credentials.save(credential);

    const result = await useCase.execute(credential.userId, null, []);

    expect(result.id).toBe(credential.userId);
    expect(result.email).toBe('user@test.com');
    expect(result.emailVerified).toBe(false);
    expect(result.authProvider).toBe('password');
    expect(result.orgId).toBeNull();
    expect(result.permissions).toEqual([]);
    expect(result.createdAt).toBe(credential.createdAt.toISOString());
  });

  it('throws UnauthorizedError for non-existent user', async () => {
    await expect(
      useCase.execute('nonexistent-user-id', null, []),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError for disabled credential', async () => {
    const email = Email.create('disabled@test.com');
    const credential = Credential.fromPersistence({
      ...Credential.createWithPassword({ email, passwordHash: 'hash' }).toPersistence(),
      status: 'disabled',
    });
    await credentials.save(credential);

    await expect(
      useCase.execute(credential.userId, null, []),
    ).rejects.toThrow(UnauthorizedError);
  });
});
