import { describe, it, expect, beforeEach } from 'vitest';
import { LoginWithGoogleUseCase } from '../application/use-cases/login-with-google';
import { SeedOrganizationRolesUseCase } from '../application/use-cases/seed-organization-roles';
import { Email } from '../domain/value-objects';
import { Credential } from '../domain/entities';
import {
  InMemoryUnitOfWork,
  MockAccessContextResolver,
  MockTokenService,
  MockGoogleVerifier,
} from './helpers';
import { AccountDisabledError } from '../domain/errors';

describe('LoginWithGoogleUseCase', () => {
  let uow: InMemoryUnitOfWork;
  let tokenService: MockTokenService;
  let googleVerifier: MockGoogleVerifier;
  let accessContext: MockAccessContextResolver;
  let useCase: LoginWithGoogleUseCase;
  let seedOrg: SeedOrganizationRolesUseCase;

  const googleProfile = {
    sub: 'google-sub-123',
    email: 'googleuser@gmail.com',
    emailVerified: true,
    name: 'Google User',
  };

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    tokenService = new MockTokenService();
    googleVerifier = new MockGoogleVerifier();
    googleVerifier.setProfile('valid-token', googleProfile);
    accessContext = new MockAccessContextResolver();
    seedOrg = new SeedOrganizationRolesUseCase(uow);
    useCase = new LoginWithGoogleUseCase(googleVerifier, uow, tokenService, accessContext, seedOrg, uow.refreshTokens);
  });

  it('creates a new account when no existing link is found', async () => {
    const result = await useCase.execute({
      idToken: 'valid-token',
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.user.email).toBe('googleuser@gmail.com');
    expect(result.user.authProvider).toBe('google');
    expect(result.isNewUser).toBe(true);
  });

  it('reuses existing linked account', async () => {
    // First login creates the account
    await useCase.execute({ idToken: 'valid-token' });

    // Second login reuses it
    const result = await useCase.execute({ idToken: 'valid-token' });

    expect(result.user.email).toBe('googleuser@gmail.com');
    expect(result.isNewUser).toBe(false);
  });

  it('links to existing credential with same email', async () => {
    const email = Email.create('googleuser@gmail.com');
    const existing = Credential.createWithPassword({
      email,
      passwordHash: 'hash',
    });
    await uow.credentials.save(existing);

    const result = await useCase.execute({ idToken: 'valid-token' });

    expect(result.user.email).toBe('googleuser@gmail.com');
    expect(result.isNewUser).toBe(false);
    expect(uow.outbox.events[0].type).toBe('auth.credential.linked_google');
  });

  it('throws AccountDisabledError for disabled linked account', async () => {
    await useCase.execute({ idToken: 'valid-token' });

    // Manually disable the credential
    const cred = await uow.credentials.findByEmail('googleuser@gmail.com');
    const disabled = Credential.fromPersistence({
      ...cred!.toPersistence(),
      status: 'disabled',
    });
    uow.credentials.clear();
    await uow.credentials.save(disabled);

    await expect(
      useCase.execute({ idToken: 'valid-token' }),
    ).rejects.toThrow(AccountDisabledError);
  });

  it('throws AccountDisabledError for disabled existing email account', async () => {
    const email = Email.create('googleuser@gmail.com');
    const existing = Credential.fromPersistence({
      ...Credential.createWithPassword({ email, passwordHash: 'hash' }).toPersistence(),
      status: 'disabled',
    });
    await uow.credentials.save(existing);

    await expect(
      useCase.execute({ idToken: 'valid-token' }),
    ).rejects.toThrow(AccountDisabledError);
  });

  it('adds outbox event for new account', async () => {
    await useCase.execute({ idToken: 'valid-token' });

    expect(uow.outbox.events).toHaveLength(1);
    expect(uow.outbox.events[0].type).toBe('identity.user.created');
    expect(uow.outbox.events[0].payload.email).toBe('googleuser@gmail.com');
  });
});
