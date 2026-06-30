import { createHash, randomBytes } from 'node:crypto';
import {
  Credential,
  OAuthAccount,
  OAuthProvider,
  RefreshToken,
} from '../domain/entities';
import {
  CredentialRepository,
  DomainEvent,
  OAuthAccountRepository,
  OutboxRepository,
  RefreshTokenRepository,
  Repositories,
} from '../domain/repositories';
import {
  AccessTokenClaims,
  GeneratedRefreshToken,
  GoogleIdTokenVerifier,
  GoogleProfile,
  IssuedAccessToken,
  PasswordHasher,
  TokenService,
  UnitOfWork,
} from '../application/ports';
import { InvalidGoogleTokenError, UnauthorizedError } from '../domain/errors';

// ---------------------------------------------------------------------------
// In-memory repositories
// ---------------------------------------------------------------------------

export class InMemoryCredentialRepository implements CredentialRepository {
  private store = new Map<string, Credential>();

  async findById(id: string): Promise<Credential | null> {
    return this.store.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<Credential | null> {
    for (const c of this.store.values()) {
      if (c.userId === userId) return c;
    }
    return null;
  }

  async findByEmail(email: string): Promise<Credential | null> {
    for (const c of this.store.values()) {
      if (c.email === email) return c;
    }
    return null;
  }

  async save(credential: Credential): Promise<void> {
    this.store.set(credential.id, credential);
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryOAuthAccountRepository implements OAuthAccountRepository {
  private store = new Map<string, OAuthAccount>();

  async findByProvider(
    provider: OAuthProvider,
    providerUserId: string,
  ): Promise<OAuthAccount | null> {
    for (const a of this.store.values()) {
      if (a.provider === provider && a.providerUserId === providerUserId) return a;
    }
    return null;
  }

  async save(account: OAuthAccount): Promise<void> {
    this.store.set(account.credentialId, account);
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private store = new Map<string, RefreshToken>();

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    for (const t of this.store.values()) {
      if (t.toPersistence().tokenHash === tokenHash) return t;
    }
    return null;
  }

  async save(token: RefreshToken): Promise<void> {
    this.store.set(token.id, token);
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryOutboxRepository implements OutboxRepository {
  events: DomainEvent[] = [];

  async add(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  clear(): void {
    this.events = [];
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  readonly credentials: InMemoryCredentialRepository;
  readonly oauthAccounts: InMemoryOAuthAccountRepository;
  readonly refreshTokens: InMemoryRefreshTokenRepository;
  readonly outbox: InMemoryOutboxRepository;

  constructor(repos?: {
    credentials?: InMemoryCredentialRepository;
    oauthAccounts?: InMemoryOAuthAccountRepository;
    refreshTokens?: InMemoryRefreshTokenRepository;
    outbox?: InMemoryOutboxRepository;
  }) {
    this.credentials = repos?.credentials ?? new InMemoryCredentialRepository();
    this.oauthAccounts = repos?.oauthAccounts ?? new InMemoryOAuthAccountRepository();
    this.refreshTokens = repos?.refreshTokens ?? new InMemoryRefreshTokenRepository();
    this.outbox = repos?.outbox ?? new InMemoryOutboxRepository();
  }

  async execute<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return work({
      credentials: this.credentials,
      oauthAccounts: this.oauthAccounts,
      refreshTokens: this.refreshTokens,
      outbox: this.outbox,
    });
  }

  clear(): void {
    this.credentials.clear();
    this.oauthAccounts.clear();
    this.refreshTokens.clear();
    this.outbox.clear();
  }
}

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

export class MockPasswordHasher implements PasswordHasher {
  // In tests we just store the plain text as "hash" for simplicity
  async hash(plain: string): Promise<string> {
    return `hashed:${plain}`;
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    return hash === `hashed:${plain}`;
  }
}

export class MockTokenService implements TokenService {
  private accessCounter = 0;

  async issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    this.accessCounter++;
    return {
      token: `access-token-${this.accessCounter}.${claims.sub}.${claims.email}`,
      expiresIn: 900,
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const parts = token.split('.');
    if (parts.length < 2) throw new UnauthorizedError();
    return { sub: parts[1], email: parts[2] ?? '' };
  }

  generateRefreshToken(): GeneratedRefreshToken {
    const token = randomBytes(16).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    return {
      token,
      hash,
      expiresAt: new Date(Date.now() + 2_592_000_000),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  get issuedAccessTokens(): number {
    return this.accessCounter;
  }
}

export class MockGoogleVerifier implements GoogleIdTokenVerifier {
  private profiles = new Map<string, GoogleProfile>();

  setProfile(idToken: string, profile: GoogleProfile): void {
    this.profiles.set(idToken, profile);
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    const profile = this.profiles.get(idToken);
    if (!profile) throw new InvalidGoogleTokenError();
    return profile;
  }
}

// ---------------------------------------------------------------------------
// Build a Repositories object from in-memory stores
// ---------------------------------------------------------------------------

export function buildInMemoryRepos(): Repositories {
  return {
    credentials: new InMemoryCredentialRepository(),
    oauthAccounts: new InMemoryOAuthAccountRepository(),
    refreshTokens: new InMemoryRefreshTokenRepository(),
    outbox: new InMemoryOutboxRepository(),
  };
}
