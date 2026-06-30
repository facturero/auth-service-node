import { describe, it, expect, beforeEach } from 'vitest';
import { LogoutUseCase } from '../application/use-cases/logout';
import { InMemoryRefreshTokenRepository, MockTokenService } from './helpers';
import { RefreshToken } from '../domain/entities';

describe('LogoutUseCase', () => {
  let refreshTokens: InMemoryRefreshTokenRepository;
  let tokenService: MockTokenService;
  let useCase: LogoutUseCase;

  beforeEach(() => {
    refreshTokens = new InMemoryRefreshTokenRepository();
    tokenService = new MockTokenService();
    useCase = new LogoutUseCase(refreshTokens, tokenService);
  });

  it('revokes an active refresh token', async () => {
    const refresh = tokenService.generateRefreshToken();
    const rt = RefreshToken.issue({
      credentialId: 'cred-1',
      tokenHash: refresh.hash,
      expiresAt: new Date(Date.now() + 86400000),
    });
    await refreshTokens.save(rt);

    expect(rt.isActive()).toBe(true);

    await useCase.execute({ refreshToken: refresh.token });

    expect(rt.isActive()).toBe(false);
  });

  it('is idempotent when token does not exist', async () => {
    await expect(
      useCase.execute({ refreshToken: 'nonexistent' }),
    ).resolves.toBeUndefined();
  });

  it('is idempotent when token is already revoked', async () => {
    const refresh = tokenService.generateRefreshToken();
    const rt = RefreshToken.issue({
      credentialId: 'cred-1',
      tokenHash: refresh.hash,
      expiresAt: new Date(Date.now() + 86400000),
    });
    rt.revoke(null);
    await refreshTokens.save(rt);

    await expect(
      useCase.execute({ refreshToken: refresh.token }),
    ).resolves.toBeUndefined();
  });
});
