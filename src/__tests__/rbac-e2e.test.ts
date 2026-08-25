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
import { DisableUserUseCase } from '../application/use-cases/disable-user';
import { ListRolesUseCase } from '../application/use-cases/list-roles';
import { CreateRoleUseCase } from '../application/use-cases/create-role';
import { UpdateRolePermissionsUseCase } from '../application/use-cases/update-role-permissions';
import { ListPermissionsUseCase } from '../application/use-cases/list-permissions';
import { CompleteProfileUseCase } from '../application/use-cases/complete-profile';
import { SeedOrganizationRolesUseCase } from '../application/use-cases/seed-organization-roles';
import { AcceptInviteUseCase } from '../application/use-cases/accept-invite';
import { RequestPasswordResetUseCase } from '../application/use-cases/request-password-reset';
import { ResetPasswordUseCase } from '../application/use-cases/reset-password';
import { ProvisionDeviceAccountUseCase } from '../application/use-cases/provision-device-account';
import { UpdateUserEstablishmentsUseCase } from '../application/use-cases/update-user-establishments';
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
  InMemoryUserEstablishmentRepository,
  InMemoryOrganizationRepository,
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
  const userEstablishments = new InMemoryUserEstablishmentRepository();
  const organizations = new InMemoryOrganizationRepository();
  const uow = new InMemoryUnitOfWork({ credentials, refreshTokens, users, roles, permissions, memberships, userRoles, userEstablishments });
  const hasher = new MockPasswordHasher();
  const tokenService = new RbacMockTokenService();
  const googleVerifier = new MockGoogleVerifier();
  const accessContext = new TestAccessContextResolver(users, memberships, roles, permissions, userRoles);
  const seedOrg = new SeedOrganizationRolesUseCase(uow);

  const deps: AppDependencies = {
    useCases: {
      register: new RegisterWithPasswordUseCase(uow, hasher, tokenService, accessContext, seedOrg, refreshTokens),
      login: new LoginWithPasswordUseCase(credentials, refreshTokens, hasher, tokenService, accessContext),
      google: new LoginWithGoogleUseCase(googleVerifier, uow, tokenService, accessContext, seedOrg, refreshTokens),
      refresh: new RefreshTokenUseCase(uow, tokenService, accessContext),
      logout: new LogoutUseCase(refreshTokens, tokenService),
      getMe: new GetMeUseCase(credentials, users, organizations),
      switchOrg: new SwitchOrganizationUseCase(uow, tokenService, accessContext),
      listUsers: new ListUsersUseCase(users, userRoles, roles, organizations, credentials, userEstablishments),
      inviteUser: new InviteUserUseCase(uow, { generateInviteToken: () => 'http://localhost:5173/accept-invite?token=mock' }),
      assignRole: new AssignRoleUseCase(uow),
      disableUser: new DisableUserUseCase(uow),
      updateUserEstablishments: new UpdateUserEstablishmentsUseCase(uow),
      listRoles: new ListRolesUseCase(roles),
      createRole: new CreateRoleUseCase(uow),
      updateRolePermissions: new UpdateRolePermissionsUseCase(uow),
      completeProfile: new CompleteProfileUseCase(uow, tokenService, accessContext, seedOrg, refreshTokens),
      listPermissions: new ListPermissionsUseCase(permissions),
      acceptInvite: new AcceptInviteUseCase(uow, hasher, tokenService, accessContext, refreshTokens),
      resetPassword: new ResetPasswordUseCase(uow, hasher, tokenService, accessContext, refreshTokens),
      requestPasswordReset: new RequestPasswordResetUseCase(uow, {
        buildResetLink: (token) => `http://localhost:5173/restablecer-contrasena?token=${encodeURIComponent(token)}`,
      }),
      provisionDeviceAccount: new ProvisionDeviceAccountUseCase(uow, tokenService),
    },
    tokenService,
    accessContext,
    corsOrigin: '*',
    internalSecret: 'test-secret',
    trustedIpsRepository: { findAll: async () => [], findEnabled: async () => [], findByIp: async () => null, create: async (d) => ({ ...d, created_at: new Date(), updated_at: new Date() }), update: async () => null, delete: async () => true },
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
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) as Json : {} };
  }

  async function getJson(path: string, token?: string): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await app.fetch(new Request(`http://localhost${path}`, { method: 'GET', headers }));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) as Json : {} };
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

  // -------------------------------------------------------------------------
  // Password permissions (password:view / password:change)
  // -------------------------------------------------------------------------
  describe('password:view gating on GET /users', () => {
    const orgId = uuidOrg;

    async function registerInOrg(email: string, permissionCodes: string[]): Promise<{ userId: string; token: string }> {
      const reg = await t.postJson('/auth/register', { email, identification: email, password: 'Secure123!' });
      const userId = (reg.json.user as Json).id as string;

      const permIds = permissionCodes.map((code) => addPermission(t.permissions, code));
      const role = Role.createForOrg({ organizationId: orgId, name: `Role-${email}`, description: '', isSystem: false });
      await t.roles.save(role);
      await t.roles.setPermissions(role.id, permIds);

      await t.memberships.save(Membership.create({ userId, organizationId: orgId, status: 'active' }));
      await t.userRoles.assign(UserRole.assign({ userId, organizationId: orgId, roleId: role.id }));

      const user = await t.users.findById(userId);
      if (user) user.bumpPermissionsVersion();

      const login = await t.postJson('/auth/login', { email, password: 'Secure123!' });
      return { userId, token: login.json.accessToken as string };
    }

    it('includes passwordHash only when the actor has password:view', async () => {
      const employee = await registerInOrg('emp@test.com', ['user:read']);
      const viewer = await registerInOrg('view@test.com', ['user:read']);
      const admin = await registerInOrg('admview@test.com', ['user:read', 'password:view']);

      const asViewer = await t.getJson('/users', viewer.token);
      expect(asViewer.status).toBe(200);
      const empForViewer = (asViewer.json as unknown as Json[]).find((u) => u.email === 'emp@test.com');
      expect((empForViewer as Json).passwordHash).toBeNull();
      expect((empForViewer as Json).hasPassword).toBe(true);

      const asAdmin = await t.getJson('/users', admin.token);
      const empForAdmin = (asAdmin.json as unknown as Json[]).find((u) => u.email === 'emp@test.com');
      expect((empForAdmin as Json).passwordHash).toBe('hashed:Secure123!');

      expect(employee.userId).toBeTruthy();
    });

    it('returns 403 without user:read even with password:view', async () => {
      const onlyPassword = await registerInOrg('pwonly@test.com', ['password:view']);
      const { status } = await t.getJson('/users', onlyPassword.token);
      expect(status).toBe(403);
    });
  });

  describe('POST /users/:id/password-reset (requirePermission: password:change)', () => {
    const orgId = uuidOrg;

    async function registerInOrg(email: string, permissionCodes: string[]): Promise<{ userId: string; token: string }> {
      const reg = await t.postJson('/auth/register', { email, identification: email, password: 'Secure123!' });
      const userId = (reg.json.user as Json).id as string;

      const permIds = permissionCodes.map((code) => addPermission(t.permissions, code));
      const role = Role.createForOrg({ organizationId: orgId, name: `Role-${email}`, description: '', isSystem: false });
      await t.roles.save(role);
      await t.roles.setPermissions(role.id, permIds);

      await t.memberships.save(Membership.create({ userId, organizationId: orgId, status: 'active' }));
      await t.userRoles.assign(UserRole.assign({ userId, organizationId: orgId, roleId: role.id }));

      const user = await t.users.findById(userId);
      if (user) user.bumpPermissionsVersion();

      const login = await t.postJson('/auth/login', { email, password: 'Secure123!' });
      return { userId, token: login.json.accessToken as string };
    }

    function lastResetEvent(): Json | null {
      const events = t.uow.outbox.events.filter((e) => e.type === 'identity.user.password_reset_requested');
      const last = events[events.length - 1];
      return last ? (last.payload as Json) : null;
    }

    it('sends a password-reset email with a single-use link', async () => {
      const admin = await registerInOrg('adminreset@test.com', ['password:change']);
      const employee = await registerInOrg('empreset@test.com', ['user:read']);

      const { status } = await t.postJson('/users/' + employee.userId + '/password-reset', {}, admin.token);
      expect(status).toBe(204);

      const payload = lastResetEvent();
      expect(payload).toBeTruthy();
      expect(payload?.userId).toBe(employee.userId);
      expect((payload?.resetUrl as string) ?? '').toContain('restablecer-contrasena?token=');
    });

    it('returns 403 when the token lacks password:change', async () => {
      const viewer = await registerInOrg('resetview@test.com', ['user:read']);
      const employee = await registerInOrg('resetemp@test.com', ['user:read']);

      const { status, json } = await t.postJson('/users/' + employee.userId + '/password-reset', {}, viewer.token);
      expect(status).toBe(403);
      expect(json.code).toBe('FORBIDDEN');
    });

    it('returns 403 when requesting your own reset', async () => {
      const admin = await registerInOrg('selfreset@test.com', ['password:change']);

      const { status, json } = await t.postJson('/users/' + admin.userId + '/password-reset', {}, admin.token);
      expect(status).toBe(403);
      expect(json.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /auth/password-reset', () => {
    const orgId = uuidOrg;

    async function registerInOrg(email: string, permissionCodes: string[]): Promise<{ userId: string; token: string }> {
      const reg = await t.postJson('/auth/register', { email, identification: email, password: 'Secure123!' });
      const userId = (reg.json.user as Json).id as string;

      const permIds = permissionCodes.map((code) => addPermission(t.permissions, code));
      const role = Role.createForOrg({ organizationId: orgId, name: `Role-${email}`, description: '', isSystem: false });
      await t.roles.save(role);
      await t.roles.setPermissions(role.id, permIds);

      await t.memberships.save(Membership.create({ userId, organizationId: orgId, status: 'active' }));
      await t.userRoles.assign(UserRole.assign({ userId, organizationId: orgId, roleId: role.id }));

      const user = await t.users.findById(userId);
      if (user) user.bumpPermissionsVersion();

      const login = await t.postJson('/auth/login', { email, password: 'Secure123!' });
      return { userId, token: login.json.accessToken as string };
    }

    function extractResetToken(email: string): string {
      const events = t.uow.outbox.events.filter((e) => e.type === 'identity.user.password_reset_requested');
      for (const e of events) {
        const payload = e.payload as Json;
        const url = payload.resetUrl as string;
        const query = url.split('?')[1] ?? '';
        const params = new URLSearchParams(query);
        if (params.get('token')) return params.get('token') as string;
      }
      throw new Error(`No reset link found for ${email}`);
    }

    it('resets the password, revokes old sessions and issues a new session', async () => {
      const admin = await registerInOrg('adminr@test.com', ['password:change']);
      const employee = await registerInOrg('empr@test.com', ['user:read']);

      await t.postJson('/users/' + employee.userId + '/password-reset', {}, admin.token);
      const token = extractResetToken(employee.userId);

      const { status, json } = await t.postJson('/auth/password-reset', { token, password: 'NuevaPass1!' });
      expect(status).toBe(200);
      expect(json.accessToken).toBeTruthy();

      // Old password no longer works
      const oldLogin = await t.postJson('/auth/login', { email: 'empr@test.com', password: 'Secure123!' });
      expect(oldLogin.status).toBe(401);

      // New password works
      const newLogin = await t.postJson('/auth/login', { email: 'empr@test.com', password: 'NuevaPass1!' });
      expect(newLogin.status).toBe(200);
    });

    it('rejects a consumed token (single use)', async () => {
      const admin = await registerInOrg('adminu@test.com', ['password:change']);
      const employee = await registerInOrg('empu@test.com', ['user:read']);

      await t.postJson('/users/' + employee.userId + '/password-reset', {}, admin.token);
      const token = extractResetToken(employee.userId);

      await t.postJson('/auth/password-reset', { token, password: 'NuevaPass1!' });
      const { status, json } = await t.postJson('/auth/password-reset', { token, password: 'OtraPass1!' });
      expect(status).toBe(400);
      expect(json.code).toBe('INVALID_RESET_TOKEN');
    });

    it('rejects an invalid token', async () => {
      const { status, json } = await t.postJson('/auth/password-reset', { token: 'no-existe', password: 'NuevaPass1!' });
      expect(status).toBe(400);
      expect(json.code).toBe('INVALID_RESET_TOKEN');
    });
  });
});

