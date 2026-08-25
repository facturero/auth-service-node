import { createHash, randomBytes } from 'node:crypto';
import {
  Credential,
  DeviceRefreshToken,
  OAuthAccount,
  OAuthProvider,
  PasswordResetToken,
  PosDevice,
  RefreshToken,
} from '../domain/entities';
import { User, Organization, Role, Permission, Membership, UserRole, UserEstablishment } from '../domain/rbac';
import {
  CredentialRepository,
  DeviceRefreshTokenRepository,
  DomainEvent,
  MembershipRepository,
  OAuthAccountRepository,
  OrganizationRepository,
  OutboxRepository,
  PasswordResetTokenRepository,
  PermissionRepository,
  PosDeviceRepository,
  RefreshTokenRepository,
  Repositories,
  RoleRepository,
  UserRepository,
  UserRoleRepository,
  UserEstablishmentRepository,
  TrustedIp,
  TrustedIpRepository,
} from '../domain/repositories';
import {
  AccessContext,
  AccessContextResolver,
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

  async revokeAllByCredentialId(credentialId: string): Promise<void> {
    for (const t of this.store.values()) {
      const props = t.toPersistence();
      if (props.credentialId === credentialId && props.revokedAt === null) {
        t.revoke();
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryPosDeviceRepository implements PosDeviceRepository {
  private store = new Map<string, PosDevice>();

  async findById(id: string): Promise<PosDevice | null> {
    return this.store.get(id) ?? null;
  }

  async findByEmissionPointId(emissionPointId: string): Promise<PosDevice | null> {
    for (const d of this.store.values()) {
      if (d.emissionPointId === emissionPointId) return d;
    }
    return null;
  }

  async save(device: PosDevice): Promise<void> {
    this.store.set(device.id, device);
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryDeviceRefreshTokenRepository implements DeviceRefreshTokenRepository {
  private store = new Map<string, DeviceRefreshToken>();

  async findByHash(tokenHash: string): Promise<DeviceRefreshToken | null> {
    for (const t of this.store.values()) {
      if (t.toPersistence().tokenHash === tokenHash) return t;
    }
    return null;
  }

  async save(token: DeviceRefreshToken): Promise<void> {
    this.store.set(token.id, token);
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryPasswordResetTokenRepository implements PasswordResetTokenRepository {
  private store = new Map<string, PasswordResetToken>();

  async findByHash(tokenHash: string): Promise<PasswordResetToken | null> {
    for (const t of this.store.values()) {
      if (t.toPersistence().tokenHash === tokenHash) return t;
    }
    return null;
  }

  async save(token: PasswordResetToken): Promise<void> {
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

// ---------------------------------------------------------------------------
// In-memory RBAC repositories
// ---------------------------------------------------------------------------

export class InMemoryUserRepository implements UserRepository {
  private store = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.store.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const u of this.store.values()) {
      if (u.email === email) return u;
    }
    return null;
  }

  async findByIdentification(identification: string): Promise<User | null> {
    for (const u of this.store.values()) {
      if (u.identification === identification) return u;
    }
    return null;
  }

  async save(user: User): Promise<void> {
    this.store.set(user.id, user);
  }

  async incrementPermissionsVersion(userId: string): Promise<void> {
    const user = this.store.get(userId);
    if (user) {
      user.bumpPermissionsVersion();
    }
  }

  async listByOrganization(_organizationId: string): Promise<User[]> {
    // This would need membership data; simplified for tests
    return Array.from(this.store.values());
  }

  clear(): void { this.store.clear(); }
}

export class InMemoryOrganizationRepository implements OrganizationRepository {
  private store = new Map<string, Organization>();

  async findById(id: string): Promise<Organization | null> {
    return this.store.get(id) ?? null;
  }

  async save(org: Organization): Promise<void> {
    this.store.set(org.id, org);
  }

  clear(): void { this.store.clear(); }
}

export class InMemoryRoleRepository implements RoleRepository {
  private store = new Map<string, Role>();
  private rolePermissions = new Map<string, string[]>(); // roleId -> permissionIds

  async findById(id: string): Promise<Role | null> {
    return this.store.get(id) ?? null;
  }

  async findTemplates(): Promise<Role[]> {
    return Array.from(this.store.values()).filter((r) => r.organizationId === null);
  }

  async findByOrganization(organizationId: string): Promise<Role[]> {
    return Array.from(this.store.values()).filter((r) => r.organizationId === organizationId);
  }

  async save(role: Role): Promise<void> {
    this.store.set(role.id, role);
  }

  async setPermissions(roleId: string, permissionIds: string[]): Promise<void> {
    this.rolePermissions.set(roleId, permissionIds);
  }

  async getPermissionCodes(roleId: string): Promise<string[]> {
    const ids = this.rolePermissions.get(roleId) ?? [];
    return ids.map((_id, i) => `perm_${i}`);
  }

  getPermissions(roleId: string): string[] {
    return this.rolePermissions.get(roleId) ?? [];
  }

  clear(): void { this.store.clear(); this.rolePermissions.clear(); }
}

export class InMemoryPermissionRepository implements PermissionRepository {
  private store = new Map<string, Permission>();

  async findAll(): Promise<Permission[]> {
    return Array.from(this.store.values());
  }

  async findIdsByCodes(codes: string[]): Promise<string[]> {
    return Array.from(this.store.values())
      .filter((p) => codes.includes(p.code))
      .map((p) => p.id);
  }

  add(p: Permission): void { this.store.set(p.id, p); }
  clear(): void { this.store.clear(); }
}

export class InMemoryMembershipRepository implements MembershipRepository {
  private store = new Map<string, Membership>();

  private key(userId: string, organizationId: string): string {
    return `${userId}:${organizationId}`;
  }

  async find(userId: string, organizationId: string): Promise<Membership | null> {
    return this.store.get(this.key(userId, organizationId)) ?? null;
  }

  async listActiveByUser(userId: string): Promise<Membership[]> {
    return Array.from(this.store.values())
      .filter((m) => m.userId === userId && m.isActive());
  }

  async save(m: Membership): Promise<void> {
    this.store.set(this.key(m.userId, m.organizationId), m);
  }

  clear(): void { this.store.clear(); }
}

export class InMemoryUserRoleRepository implements UserRoleRepository {
  private store = new Map<string, UserRole>();

  async assign(userRole: UserRole): Promise<void> {
    this.store.set(userRole.id, userRole);
  }

  async remove(userId: string, organizationId: string, roleId: string): Promise<void> {
    for (const [k, v] of this.store) {
      if (v.userId === userId && v.organizationId === organizationId && v.roleId === roleId) {
        this.store.delete(k);
      }
    }
  }

  async removeAllByUser(userId: string, organizationId: string): Promise<void> {
    for (const [k, v] of this.store) {
      if (v.userId === userId && v.organizationId === organizationId) {
        this.store.delete(k);
      }
    }
  }

  async listByUserAndOrg(userId: string, organizationId: string): Promise<UserRole[]> {
    return Array.from(this.store.values())
      .filter((ur) => ur.userId === userId && ur.organizationId === organizationId);
  }

  async listUserIdsByRole(roleId: string): Promise<string[]> {
    return Array.from(this.store.values())
      .filter((ur) => ur.roleId === roleId)
      .map((ur) => ur.userId);
  }

  clear(): void { this.store.clear(); }
}

export class InMemoryUserEstablishmentRepository implements UserEstablishmentRepository {
  private store = new Map<string, UserEstablishment>();

  async listByUser(userId: string): Promise<UserEstablishment[]> {
    return Array.from(this.store.values())
      .filter((ue) => ue.userId === userId);
  }

  async listUserIdsByEstablishment(establishmentId: string): Promise<string[]> {
    return Array.from(this.store.values())
      .filter((ue) => ue.establishmentId === establishmentId)
      .map((ue) => ue.userId);
  }

  async replaceForUser(userId: string, establishmentIds: string[]): Promise<void> {
    for (const [k, v] of this.store) {
      if (v.userId === userId) this.store.delete(k);
    }
    for (const establishmentId of establishmentIds) {
      const ue = UserEstablishment.assign({ userId, establishmentId });
      this.store.set(ue.id, ue);
    }
  }

  clear(): void { this.store.clear(); }
}

export class InMemoryTrustedIpRepository implements TrustedIpRepository {
  private store = new Map<string, TrustedIp>();

  async findAll(): Promise<TrustedIp[]> {
    return Array.from(this.store.values());
  }
  async findEnabled(): Promise<TrustedIp[]> {
    return Array.from(this.store.values()).filter((e) => e.enabled);
  }
  async findByIp(ip: string): Promise<TrustedIp | null> {
    return Array.from(this.store.values()).find((e) => e.ip === ip) ?? null;
  }
  async create(data: Omit<TrustedIp, 'created_at' | 'updated_at'>): Promise<TrustedIp> {
    const now = new Date();
    const entry: TrustedIp = { ...data, created_at: now, updated_at: now };
    this.store.set(entry.id, entry);
    return entry;
  }
  async update(id: string, data: Partial<Pick<TrustedIp, 'ip' | 'label' | 'enabled'>>): Promise<TrustedIp | null> {
    const entry = this.store.get(id);
    if (!entry) return null;
    Object.assign(entry, data, { updated_at: new Date() });
    return entry;
  }
  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  readonly credentials: InMemoryCredentialRepository;
  readonly oauthAccounts: InMemoryOAuthAccountRepository;
  readonly refreshTokens: InMemoryRefreshTokenRepository;
  readonly posDevices: InMemoryPosDeviceRepository;
  readonly deviceRefreshTokens: InMemoryDeviceRefreshTokenRepository;
  readonly passwordResetTokens: InMemoryPasswordResetTokenRepository;
  readonly outbox: InMemoryOutboxRepository;
  readonly users: InMemoryUserRepository;
  readonly organizations: InMemoryOrganizationRepository;
  readonly roles: InMemoryRoleRepository;
  readonly permissions: InMemoryPermissionRepository;
  readonly memberships: InMemoryMembershipRepository;
  readonly userRoles: InMemoryUserRoleRepository;
  readonly userEstablishments: InMemoryUserEstablishmentRepository;
  readonly trustedIps: InMemoryTrustedIpRepository;

  constructor(repos?: {
    credentials?: InMemoryCredentialRepository;
    oauthAccounts?: InMemoryOAuthAccountRepository;
    refreshTokens?: InMemoryRefreshTokenRepository;
    posDevices?: InMemoryPosDeviceRepository;
    deviceRefreshTokens?: InMemoryDeviceRefreshTokenRepository;
    passwordResetTokens?: InMemoryPasswordResetTokenRepository;
    outbox?: InMemoryOutboxRepository;
    users?: InMemoryUserRepository;
    organizations?: InMemoryOrganizationRepository;
    roles?: InMemoryRoleRepository;
    permissions?: InMemoryPermissionRepository;
    memberships?: InMemoryMembershipRepository;
    userRoles?: InMemoryUserRoleRepository;
    userEstablishments?: InMemoryUserEstablishmentRepository;
    trustedIps?: InMemoryTrustedIpRepository;
  }) {
    this.credentials = repos?.credentials ?? new InMemoryCredentialRepository();
    this.oauthAccounts = repos?.oauthAccounts ?? new InMemoryOAuthAccountRepository();
    this.refreshTokens = repos?.refreshTokens ?? new InMemoryRefreshTokenRepository();
    this.posDevices = repos?.posDevices ?? new InMemoryPosDeviceRepository();
    this.deviceRefreshTokens = repos?.deviceRefreshTokens ?? new InMemoryDeviceRefreshTokenRepository();
    this.passwordResetTokens = repos?.passwordResetTokens ?? new InMemoryPasswordResetTokenRepository();
    this.outbox = repos?.outbox ?? new InMemoryOutboxRepository();
    this.users = repos?.users ?? new InMemoryUserRepository();
    this.organizations = repos?.organizations ?? new InMemoryOrganizationRepository();
    this.roles = repos?.roles ?? new InMemoryRoleRepository();
    this.permissions = repos?.permissions ?? new InMemoryPermissionRepository();
    this.memberships = repos?.memberships ?? new InMemoryMembershipRepository();
    this.userRoles = repos?.userRoles ?? new InMemoryUserRoleRepository();
    this.userEstablishments = repos?.userEstablishments ?? new InMemoryUserEstablishmentRepository();
    this.trustedIps = repos?.trustedIps ?? new InMemoryTrustedIpRepository();
  }

  async execute<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return work({
      credentials: this.credentials,
      oauthAccounts: this.oauthAccounts,
      refreshTokens: this.refreshTokens,
      posDevices: this.posDevices,
      deviceRefreshTokens: this.deviceRefreshTokens,
      passwordResetTokens: this.passwordResetTokens,
      outbox: this.outbox,
      users: this.users,
      organizations: this.organizations,
      roles: this.roles,
      permissions: this.permissions,
      memberships: this.memberships,
      userRoles: this.userRoles,
      userEstablishments: this.userEstablishments,
      trustedIps: this.trustedIps,
    });
  }

  clear(): void {
    this.credentials.clear();
    this.oauthAccounts.clear();
    this.refreshTokens.clear();
    this.posDevices.clear();
    this.deviceRefreshTokens.clear();
    this.passwordResetTokens.clear();
    this.outbox.clear();
    this.users.clear();
    this.organizations.clear();
    this.roles.clear();
    this.permissions.clear();
    this.memberships.clear();
    this.userRoles.clear();
    this.userEstablishments.clear();
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
    return {
      sub: parts[1],
      email: parts[2] ?? '',
      orgId: null,
      countryCode: null,
      permissions: [],
      pv: 0,
    };
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

export class MockAccessContextResolver implements AccessContextResolver {
  async resolve(_userId: string, _preferredOrgId?: string | null): Promise<AccessContext> {
    return { orgId: null, countryCode: null, permissions: [], pv: 0 };
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
    posDevices: new InMemoryPosDeviceRepository(),
    deviceRefreshTokens: new InMemoryDeviceRefreshTokenRepository(),
    passwordResetTokens: new InMemoryPasswordResetTokenRepository(),
    outbox: new InMemoryOutboxRepository(),
    users: new InMemoryUserRepository(),
    organizations: new InMemoryOrganizationRepository(),
    roles: new InMemoryRoleRepository(),
    permissions: new InMemoryPermissionRepository(),
    memberships: new InMemoryMembershipRepository(),
    userRoles: new InMemoryUserRoleRepository(),
    userEstablishments: new InMemoryUserEstablishmentRepository(),
    trustedIps: new InMemoryTrustedIpRepository(),
  };
}
