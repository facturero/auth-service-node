import { describe, it, expect, beforeEach } from 'vitest';
import { RefreshTokenUseCase } from '../application/use-cases/refresh-token';
import { Email } from '../domain/value-objects';
import { Credential, RefreshToken } from '../domain/entities';
import {
  InMemoryUnitOfWork,
  MockAccessContextResolver,
  MockTokenService,
} from './helpers';
import { InvalidRefreshTokenError, AccountDisabledError } from '../domain/errors';

describe('RefreshTokenUseCase', () => {
  let uow: InMemoryUnitOfWork;
  let tokenService: MockTokenService;
  let accessContext: MockAccessContextResolver;
  let useCase: RefreshTokenUseCase;

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    tokenService = new MockTokenService();
    accessContext = new MockAccessContextResolver();
    useCase = new RefreshTokenUseCase(uow, tokenService, accessContext);
  });

  async function seedSession(): Promise<string> {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({
      email,
      passwordHash: 'hash',
    });
    await uow.credentials.save(credential);

    const refresh = tokenService.generateRefreshToken();
    const rt = RefreshToken.issue({
      credentialId: credential.id,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });
    await uow.refreshTokens.save(rt);

    return refresh.token;
  }

  it('rotates the refresh token and returns a new session', async () => {
    const originalToken = await seedSession();

    const result = await useCase.execute({ refreshToken: originalToken });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshToken).not.toBe(originalToken);
  });

  it('revokes the old refresh token', async () => {
    const originalToken = await seedSession();
    const originalHash = tokenService.hashRefreshToken(originalToken);

    await useCase.execute({ refreshToken: originalToken });

    const old = await uow.refreshTokens.findByHash(originalHash);
    expect(old).not.toBeNull();
    expect(old!.isActive()).toBe(false);
  });

  it('throws InvalidRefreshTokenError for unknown token', async () => {
    await expect(
      useCase.execute({ refreshToken: 'nonexistent-token' }),
    ).rejects.toThrow(InvalidRefreshTokenError);
  });

  it('throws InvalidRefreshTokenError for revoked token', async () => {
    const token = await seedSession();
    const hash = tokenService.hashRefreshToken(token);
    const stored = await uow.refreshTokens.findByHash(hash);
    stored!.revoke(null);
    await uow.refreshTokens.save(stored!);

    await expect(
      useCase.execute({ refreshToken: token }),
    ).rejects.toThrow(InvalidRefreshTokenError);
  });

  it('throws AccountDisabledError for disabled credential', async () => {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({
      email,
      passwordHash: 'hash',
    });
    // Save as disabled
    const disabled = Credential.fromPersistence({
      ...credential.toPersistence(),
      status: 'disabled',
    });
    await uow.credentials.save(disabled);

    const refresh = tokenService.generateRefreshToken();
    const rt = RefreshToken.issue({
      credentialId: disabled.id,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });
    await uow.refreshTokens.save(rt);

    await expect(
      useCase.execute({ refreshToken: refresh.token }),
    ).rejects.toThrow(AccountDisabledError);
  });
});
