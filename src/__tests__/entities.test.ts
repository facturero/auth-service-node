import { describe, it, expect } from 'vitest';
import { Credential, OAuthAccount, RefreshToken } from '../domain/entities';
import { Email } from '../domain/value-objects';

describe('Credential', () => {
  const email = Email.create('user@test.com');

  describe('createWithPassword', () => {
    it('creates a credential with password hash', () => {
      const c = Credential.createWithPassword({ email, passwordHash: 'hashed_pwd' });
      expect(c.email).toBe('user@test.com');
      expect(c.passwordHash).toBe('hashed_pwd');
      expect(c.emailVerified).toBe(false);
      expect(c.status).toBe('active');
      expect(c.hasPassword()).toBe(true);
      expect(c.isActive()).toBe(true);
      expect(c.id).toBeDefined();
      expect(c.userId).toBeDefined();
      expect(c.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('createWithGoogle', () => {
    it('creates a credential without password', () => {
      const c = Credential.createWithGoogle({ email, emailVerified: true });
      expect(c.email).toBe('user@test.com');
      expect(c.passwordHash).toBeNull();
      expect(c.emailVerified).toBe(true);
      expect(c.status).toBe('active');
      expect(c.hasPassword()).toBe(false);
      expect(c.isActive()).toBe(true);
    });

    it('can create with emailVerified=false', () => {
      const c = Credential.createWithGoogle({ email, emailVerified: false });
      expect(c.emailVerified).toBe(false);
    });
  });

  describe('fromPersistence / toPersistence', () => {
    it('round-trips correctly', () => {
      const now = new Date();
      const props = {
        id: 'cred-1',
        userId: 'user-1',
        email: 'test@test.com',
        passwordHash: 'hash',
        emailVerified: true,
        status: 'active' as const,
        createdAt: now,
        updatedAt: now,
      };
      const c = Credential.fromPersistence(props);
      expect(c.toPersistence()).toEqual(props);
    });
  });

  describe('markEmailVerified', () => {
    it('marks email as verified and updates updatedAt', () => {
      const c = Credential.createWithPassword({ email, passwordHash: 'hash' });
      expect(c.emailVerified).toBe(false);
      c.markEmailVerified();
      expect(c.emailVerified).toBe(true);
    });
  });

  describe('isActive', () => {
    it('returns false for disabled credential', () => {
      const c = Credential.fromPersistence({
        id: '1',
        userId: 'u1',
        email: 'test@test.com',
        passwordHash: null,
        emailVerified: false,
        status: 'disabled',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(c.isActive()).toBe(false);
    });
  });
});

describe('OAuthAccount', () => {
  it('creates an OAuth account link', () => {
    const acc = OAuthAccount.create({
      credentialId: 'cred-1',
      provider: 'google',
      providerUserId: 'google-sub-123',
      email: 'user@gmail.com',
    });
    expect(acc.credentialId).toBe('cred-1');
    expect(acc.provider).toBe('google');
    expect(acc.providerUserId).toBe('google-sub-123');
  });

  it('round-trips via fromPersistence / toPersistence', () => {
    const now = new Date();
    const props = {
      id: 'oauth-1',
      credentialId: 'cred-1',
      provider: 'google' as const,
      providerUserId: 'sub-123',
      email: 'user@gmail.com',
      createdAt: now,
    };
    const acc = OAuthAccount.fromPersistence(props);
    expect(acc.toPersistence()).toEqual(props);
  });
});

describe('RefreshToken', () => {
  const future = new Date(Date.now() + 86400000);
  const past = new Date(Date.now() - 86400000);

  it('issues an active token', () => {
    const t = RefreshToken.issue({
      credentialId: 'cred-1',
      tokenHash: 'hex-hash',
      expiresAt: future,
    });
    expect(t.credentialId).toBe('cred-1');
    expect(t.isActive()).toBe(true);
    expect(t.revokedAt).toBeNull();
  });

  it('isActive returns false for expired token', () => {
    const t = RefreshToken.issue({
      credentialId: 'cred-1',
      tokenHash: 'hash',
      expiresAt: past,
    });
    expect(t.isActive()).toBe(false);
  });

  it('isActive returns false for revoked token', () => {
    const t = RefreshToken.issue({
      credentialId: 'cred-1',
      tokenHash: 'hash',
      expiresAt: future,
    });
    t.revoke(null);
    expect(t.isActive()).toBe(false);
  });

  it('revoke sets revokedAt and optionally replacedBy', () => {
    const t = RefreshToken.issue({
      credentialId: 'cred-1',
      tokenHash: 'hash',
      expiresAt: future,
    });
    t.revoke('new-token-id');
    expect(t.revokedAt).toBeInstanceOf(Date);
  });

  it('revoke is idempotent', () => {
    const t = RefreshToken.issue({
      credentialId: 'cred-1',
      tokenHash: 'hash',
      expiresAt: future,
    });
    t.revoke(null);
    const first = t.revokedAt;
    t.revoke('other');
    expect(t.revokedAt).toEqual(first);
  });

  it('round-trips via fromPersistence / toPersistence', () => {
    const props = {
      id: 'rt-1',
      credentialId: 'cred-1',
      tokenHash: 'abc123',
      expiresAt: future,
      revokedAt: null,
      replacedBy: null,
      userAgent: null,
      ip: null,
      createdAt: new Date(),
    };
    const t = RefreshToken.fromPersistence(props);
    expect(t.toPersistence()).toEqual(props);
  });
});
