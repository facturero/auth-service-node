import { describe, it, expect, beforeEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../interface/http/app';
import { AppDependencies } from '../interface/http/routes';
import { RegisterWithPasswordUseCase } from '../application/use-cases/register-with-password';
import { LoginWithPasswordUseCase } from '../application/use-cases/login-with-password';
import { LoginWithGoogleUseCase } from '../application/use-cases/login-with-google';
import { RefreshTokenUseCase } from '../application/use-cases/refresh-token';
import { LogoutUseCase } from '../application/use-cases/logout';
import { GetMeUseCase } from '../application/use-cases/get-me';
import { SwitchOrganizationUseCase } from '../application/use-cases/switch-organization';
import { ListUsersUseCase } from '../application/use-cases/list-users';
import { InviteUserUseCase } from '../application/use-cases/invite-user';
import { AssignRoleUseCase } from '../application/use-cases/assign-role';
import { ListRolesUseCase } from '../application/use-cases/list-roles';
import { CreateRoleUseCase } from '../application/use-cases/create-role';
import { UpdateRolePermissionsUseCase } from '../application/use-cases/update-role-permissions';
import { ListPermissionsUseCase } from '../application/use-cases/list-permissions';
import { CompleteProfileUseCase } from '../application/use-cases/complete-profile';
import { SeedOrganizationRolesUseCase } from '../application/use-cases/seed-organization-roles';
import {
  AccessTokenClaims,
  GeneratedRefreshToken,
  IssuedAccessToken,
  TokenService,
} from '../application/ports';
import {
  InMemoryUnitOfWork,
  InMemoryCredentialRepository,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  InMemoryRoleRepository,
  InMemoryPermissionRepository,
  InMemoryMembershipRepository,
  InMemoryUserRoleRepository,
  MockAccessContextResolver,
  MockPasswordHasher,
  MockGoogleVerifier,
} from './helpers';
import { Permission, Role, Membership, UserRole } from '../domain/rbac';
import { UnauthorizedError } from '../domain/errors';

// ---------------------------------------------------------------------------
// Token service que preserva claims completos (permissions, orgId, pv)
// ---------------------------------------------------------------------------
class RbacMockTokenService implements TokenService {
  private issued = new Map<string, AccessTokenClaims>();
  private counter = 0;

  async issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    this.counter++;
    const token = `rbac-at-${this.counter}`;
    this.issued.set(token, claims);
    return { token, expiresIn: 900 };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const claims = this.issued.get(token);
    if (!claims) throw new UnauthorizedError();
    return claims;
  }

  generateRefreshToken(): GeneratedRefreshToken {
    const token = randomBytes(16).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    return { token, hash, expiresAt: new Date(Date.now() + 2_592_000_000) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

// ---------------------------------------------------------------------------
// AccessContextResolver que usa repos in-memory
// ---------------------------------------------------------------------------
class TestAccessContextResolver extends MockAccessContextResolver {
  constructor(
    private readonly users: InMemoryUserRepository,
    private readonly memberships: InMemoryMembershipRepository,
    private readonly roles: InMemoryRoleRepository,
    private readonly permissions: InMemoryPermissionRepository,
    private readonly userRoles: InMemoryUserRoleRepository,
  ) { super(); }

  override async resolve(userId: string, preferredOrgId?: string | null) {
    const user = await this.users.findById(userId);
    const pv = user?.permissionsVersion ?? 0;

    let orgId: string | null = null;
    if (preferredOrgId) {
      const m = await this.memberships.find(userId, preferredOrgId);
      if (m?.isActive()) orgId = preferredOrgId;
    }
    if (!orgId) {
      const active = await this.memberships.listActiveByUser(userId);
      orgId = active.length > 0 ? active[0].organizationId : null;
    }

    if (orgId) {
      const urs = await this.userRoles.listByUserAndOrg(userId, orgId);
      const roleIds = urs.map((ur) => ur.roleId);
      const allPermIds: string[] = [];
      for (const rid of roleIds) {
        allPermIds.push(...this.roles.getPermissions(rid));
      }
      const allPerms = await this.permissions.findAll();
      const codes = allPerms.filter((p) => allPermIds.includes(p.id)).map((p) => p.code);

      return { orgId, countryCode: null, permissions: [...new Set(codes)], pv };
    }

    return { orgId: null, countryCode: null, permissions: [], pv };
  }
}

// ---------------------------------------------------------------------------
// Helper para construir la app de test con acceso a repos
// ---------------------------------------------------------------------------
type Json = Record<string, unknown>;

function buildTestApp() {
  const credentials = new InMemoryCredentialRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const users = new InMemoryUserRepository();
  const roles = new InMemoryRoleRepository();
  const permissions = new InMemoryPermissionRepository();
  const memberships = new InMemoryMembershipRepository();
  const userRoles = new InMemoryUserRoleRepository();
  const uow = new InMemoryUnitOfWork({ credentials, refreshTokens, users, roles, permissions, memberships, userRoles });
  const hasher = new MockPasswordHasher();
  const tokenService = new RbacMockTokenService();
  const googleVerifier = new MockGoogleVerifier();
  const accessContext = new TestAccessContextResolver(users, memberships, roles, permissions, userRoles);
  const seedOrg = new SeedOrganizationRolesUseCase(uow);

  const deps: AppDependencies = {
    useCases: {
      register: new RegisterWithPasswordUseCase(uow, hasher, tokenService, accessContext, seedOrg),
      login: new LoginWithPasswordUseCase(credentials, refreshTokens, hasher, tokenService, accessContext),
      google: new LoginWithGoogleUseCase(googleVerifier, uow, tokenService, accessContext, seedOrg),
      refresh: new RefreshTokenUseCase(uow, tokenService, accessContext),
      logout: new LogoutUseCase(refreshTokens, tokenService),
      getMe: new GetMeUseCase(credentials),
      switchOrg: new SwitchOrganizationUseCase(uow, tokenService, accessContext),
      listUsers: new ListUsersUseCase(users),
      inviteUser: new InviteUserUseCase(uow),
      assignRole: new AssignRoleUseCase(uow),
      listRoles: new ListRolesUseCase(roles),
      createRole: new CreateRoleUseCase(uow),
      updateRolePermissions: new UpdateRolePermissionsUseCase(uow),
      completeProfile: new CompleteProfileUseCase(uow),
      listPermissions: new ListPermissionsUseCase(permissions),
    },
    tokenService,
    accessContext,
    corsOrigin: '*',
  };

  const app = createApp(deps);

  async function postJson(path: string, body: unknown, token?: string): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await app.fetch(new Request(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json() as Json };
  }

  async function getJson(path: string, token?: string): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await app.fetch(new Request(`http://localhost${path}`, { method: 'GET', headers }));
    return { status: res.status, json: await res.json() as Json };
  }

  return { app, postJson, getJson, uow, credentials, users, roles, permissions, memberships, userRoles, tokenService };
}

function addPermission(repo: InMemoryPermissionRepository, code: string): string {
  const id = `perm-${code.replace(/:/g, '-')}`;
  const p = Permission.fromPersistence({
    id,
    code,
    resource: code.split(':')[0] ?? code,
    action: code.split(':')[1] ?? code,
    description: code,
  });
  repo.add(p);
  return id;
}

describe('E2E: RBAC API', () => {
  let t: ReturnType<typeof buildTestApp>;
  const uuidOrg = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    t = buildTestApp();
  });

  describe('GET /users (requirePermission: user:read)', () => {
    it('returns users when token has user:read permission', async () => {
      const permUserReadId = addPermission(t.permissions, 'user:read');

      // Register a user
      const reg = await t.postJson('/auth/register', { email: 'admin@test.com', identification: 'admin@test.com', password: 'Secure123!' });
      const userId = (reg.json.user as Json).id as string;

      // Create org membership + role with user:read permission
      const orgId = uuidOrg;
      const role = Role.createForOrg({ organizationId: orgId, name: 'Admin', description: 'Admin', isSystem: true });
      await t.roles.save(role);
      await t.roles.setPermissions(role.id, [permUserReadId]);

      const membership = Membership.create({ userId, organizationId: orgId, status: 'active' });
      await t.memberships.save(membership);

      const ur = UserRole.assign({ userId, organizationId: orgId, roleId: role.id });
      await t.userRoles.assign(ur);

      // Sync pv
      const user = await t.users.findById(userId);
      if (user) user.bumpPermissionsVersion();

      // Login again to get token with permissions
      const login = await t.postJson('/auth/login', { email: 'admin@test.com', password: 'Secure123!' });
      const token = login.json.accessToken as string;

      const { status, json } = await t.getJson('/users', token);
      expect(status).toBe(200);
      expect(Array.isArray(json)).toBe(true);
    });

    it('returns 403 when token lacks user:read permission', async () => {
      const reg = await t.postJson('/auth/register', { email: 'user@test.com', identification: 'user@test.com', password: 'Secure123!' });
      const token = reg.json.accessToken as string;

      // No memberships → no permissions
      const { status, json } = await t.getJson('/users', token);
      expect(status).toBe(403);
      expect(json.code).toBe('FORBIDDEN');
    });

    it('returns 401 without token', async () => {
      const { status } = await t.getJson('/users');
      expect(status).toBe(401);
    });
  });

  describe('POST /auth/register includes org context', () => {
    it('access token includes orgId and permissions after membership', async () => {
      const permId = addPermission(t.permissions, 'customer:read');

      const reg = await t.postJson('/auth/register', { email: 'u@t.com', identification: 'u@t.com', password: 'Secure123!' });
      const userId = (reg.json.user as Json).id as string;

      // No org yet → token should not have org
      const token1 = reg.json.accessToken as string;
      const claims1 = await t.tokenService.verifyAccessToken(token1);
      expect(claims1.orgId).toBeNull();
      expect(claims1.permissions).toEqual([]);

      // Create org and assign role
      const orgId = uuidOrg;
      const role = Role.createForOrg({ organizationId: orgId, name: 'Admin', description: '', isSystem: true });
      await t.roles.save(role);
      await t.roles.setPermissions(role.id, [permId]);
      await t.memberships.save(Membership.create({ userId, organizationId: orgId, status: 'active' }));
      await t.userRoles.assign(UserRole.assign({ userId, organizationId: orgId, roleId: role.id }));
      const user = await t.users.findById(userId);
      if (user) user.bumpPermissionsVersion();

      // Re-login should now include org context
      const login = await t.postJson('/auth/login', { email: 'u@t.com', password: 'Secure123!' });
      const token2 = login.json.accessToken as string;
      expect(token2).toBeTruthy();

      const claims2 = await t.tokenService.verifyAccessToken(token2);
      expect(claims2.orgId).toBe(orgId);
      expect(claims2.permissions).toContain('customer:read');
    });
  });

  describe('POST /auth/switch-organization', () => {
    const orgA = uuidOrg;
    const orgB = '550e8400-e29b-41d4-a716-446655440001';

    it('returns a new session with different org context', async () => {
      const reg = await t.postJson('/auth/register', { email: 'switch@test.com', identification: 'switch@test.com', password: 'Secure123!' });
      const userId = (reg.json.user as Json).id as string;

      const roleA = Role.createForOrg({ organizationId: orgA, name: 'Admin', description: '', isSystem: true });
      await t.roles.save(roleA);
      const roleB = Role.createForOrg({ organizationId: orgB, name: 'Viewer', description: '', isSystem: true });
      await t.roles.save(roleB);

      await t.memberships.save(Membership.create({ userId, organizationId: orgA, status: 'active' }));
      await t.memberships.save(Membership.create({ userId, organizationId: orgB, status: 'active' }));
      await t.userRoles.assign(UserRole.assign({ userId, organizationId: orgA, roleId: roleA.id }));
      await t.userRoles.assign(UserRole.assign({ userId, organizationId: orgB, roleId: roleB.id }));

      // Switch to org A
      const token = reg.json.accessToken as string;
      const switchRes = await t.postJson('/auth/switch-organization', { organizationId: orgA }, token);
      expect(switchRes.status).toBe(200);
      expect(switchRes.json.accessToken).toBeTruthy();

      const claimsA = await t.tokenService.verifyAccessToken(switchRes.json.accessToken as string);
      expect(claimsA.orgId).toBe(orgA);
    });

    it('returns 403 when not a member', async () => {
      const reg = await t.postJson('/auth/register', { email: 'nope@test.com', identification: 'nope@test.com', password: 'Secure123!' });
      const token = reg.json.accessToken as string;

      const fakeOrg = '550e8400-e29b-41d4-a716-446655440099';
      const { status } = await t.postJson('/auth/switch-organization', { organizationId: fakeOrg }, token);
      expect(status).toBe(403);
    });
  });
});
