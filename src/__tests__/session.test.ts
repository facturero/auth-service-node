import { describe, it, expect } from 'vitest';
import { issueSession } from '../application/session';
import { Email } from '../domain/value-objects';
import { Credential } from '../domain/entities';
import {
  InMemoryRefreshTokenRepository,
  MockTokenService,
} from './helpers';

describe('issueSession', () => {
  it('issues an access token and refresh token', async () => {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({
      email,
      passwordHash: 'hash',
    });
    const tokenService = new MockTokenService();
    const refreshTokens = new InMemoryRefreshTokenRepository();

    const result = await issueSession({
      credential,
      tokenService,
      refreshTokens,
      authProvider: 'password',
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBeGreaterThan(0);
    expect(result.refreshToken).toBeTruthy();
    expect(result.user).toEqual({
      id: credential.userId,
      email: 'user@test.com',
      emailVerified: false,
      authProvider: 'password',
      avatarFileId: null,
    });
  });

  it('persists the refresh token', async () => {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({
      email,
      passwordHash: 'hash',
    });
    const tokenService = new MockTokenService();
    const refreshTokens = new InMemoryRefreshTokenRepository();

    const result = await issueSession({
      credential,
      tokenService,
      refreshTokens,
      authProvider: 'password',
    });

    const hash = tokenService.hashRefreshToken(result.refreshToken);
    const saved = await refreshTokens.findByHash(hash);
    expect(saved).not.toBeNull();
    expect(saved!.credentialId).toBe(credential.id);
  });

  it('includes isNewUser when provided', async () => {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({
      email,
      passwordHash: 'hash',
    });
    const tokenService = new MockTokenService();
    const refreshTokens = new InMemoryRefreshTokenRepository();

    const result = await issueSession({
      credential,
      tokenService,
      refreshTokens,
      authProvider: 'google',
      isNewUser: true,
    });

    expect(result.isNewUser).toBe(true);
  });

  it('omits isNewUser when not provided', async () => {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({
      email,
      passwordHash: 'hash',
    });
    const tokenService = new MockTokenService();
    const refreshTokens = new InMemoryRefreshTokenRepository();

    const result = await issueSession({
      credential,
      tokenService,
      refreshTokens,
      authProvider: 'password',
    });

    expect(result.isNewUser).toBeUndefined();
  });
});
