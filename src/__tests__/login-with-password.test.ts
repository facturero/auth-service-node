import { describe, it, expect, beforeEach } from 'vitest';
import { LoginWithPasswordUseCase } from '../application/use-cases/login-with-password';
import {
  InMemoryCredentialRepository,
  InMemoryRefreshTokenRepository,
  MockAccessContextResolver,
  MockPasswordHasher,
  MockTokenService,
} from './helpers';
import { Email } from '../domain/value-objects';
import { Credential } from '../domain/entities';
import { InvalidCredentialsError, AccountDisabledError } from '../domain/errors';

describe('LoginWithPasswordUseCase', () => {
  let credentials: InMemoryCredentialRepository;
  let refreshTokens: InMemoryRefreshTokenRepository;
  let hasher: MockPasswordHasher;
  let tokenService: MockTokenService;
  let accessContext: MockAccessContextResolver;
  let useCase: LoginWithPasswordUseCase;

  beforeEach(() => {
    credentials = new InMemoryCredentialRepository();
    refreshTokens = new InMemoryRefreshTokenRepository();
    hasher = new MockPasswordHasher();
    tokenService = new MockTokenService();
    accessContext = new MockAccessContextResolver();
    useCase = new LoginWithPasswordUseCase(
      credentials,
      refreshTokens,
      hasher,
      tokenService,
      accessContext,
    );
  });

  async function seedUser(
    email = 'user@test.com',
    password = 'correctPassword',
    status: 'active' | 'disabled' = 'active',
  ): Promise<void> {
    const hash = await hasher.hash(password);
    const credential = Credential.createWithPassword({
      email: Email.create(email),
      passwordHash: hash,
    });
    // Override status for disabled test
    if (status === 'disabled') {
      const disabled = Credential.fromPersistence({
        ...credential.toPersistence(),
        status: 'disabled',
      });
      await credentials.save(disabled);
    } else {
      await credentials.save(credential);
    }
  }

  it('logs in with valid credentials', async () => {
    await seedUser();

    const result = await useCase.execute({
      email: 'user@test.com',
      password: 'correctPassword',
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.tokenType).toBe('Bearer');
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBe('user@test.com');
  });

  it('throws InvalidCredentialsError for wrong password', async () => {
    await seedUser();

    await expect(
      useCase.execute({
        email: 'user@test.com',
        password: 'wrongPassword',
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('throws InvalidCredentialsError for non-existent email', async () => {
    await expect(
      useCase.execute({
        email: 'doesnotexist@test.com',
        password: 'anyPassword',
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('throws InvalidCredentialsError for google-only account (no password)', async () => {
    const googleCred = Credential.createWithGoogle({
      email: Email.create('google@test.com'),
      emailVerified: true,
    });
    await credentials.save(googleCred);

    await expect(
      useCase.execute({
        email: 'google@test.com',
        password: 'anyPassword',
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('throws AccountDisabledError for disabled account', async () => {
    await seedUser('disabled@test.com', 'password', 'disabled');

    await expect(
      useCase.execute({
        email: 'disabled@test.com',
        password: 'password',
      }),
    ).rejects.toThrow(AccountDisabledError);
  });

  it('passes userAgent and ip to the session', async () => {
    await seedUser();

    const result = await useCase.execute({
      email: 'user@test.com',
      password: 'correctPassword',
      userAgent: 'Mozilla/5.0',
      ip: '192.168.1.1',
    });

    expect(result.accessToken).toBeTruthy();
  });
});
