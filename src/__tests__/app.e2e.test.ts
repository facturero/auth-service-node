import { describe, it, expect, beforeEach } from 'vitest';
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
  MockTokenService,
  MockGoogleVerifier,
} from './helpers';

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
  const tokenService = new MockTokenService();
  const googleVerifier = new MockGoogleVerifier();
  const accessContext = new MockAccessContextResolver();
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

  const post = (path: string, body: unknown) =>
    app.fetch(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const get = (path: string, token?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return app.fetch(new Request(`http://localhost${path}`, { method: 'GET', headers }));
  };

  async function postJson(path: string, body: unknown): Promise<{ status: number; json: Json }> {
    const res = await post(path, body);
    return { status: res.status, json: await res.json() as Json };
  }

  async function getJson(path: string, token?: string): Promise<{ status: number; json: Json }> {
    const res = await get(path, token);
    return { status: res.status, json: await res.json() as Json };
  }

  return { app, post, get, postJson, getJson, uow, credentials, refreshTokens, hasher, tokenService, googleVerifier };
}

describe('E2E: Auth API', () => {
  let t: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    t = buildTestApp();
    t.googleVerifier.setProfile('google-id-token', {
      sub: 'google-sub-456',
      email: 'googleuser@gmail.com',
      emailVerified: true,
    });
  });

  describe('GET /health', () => {
    it('returns ok', async () => {
      const res = await t.app.fetch(new Request('http://localhost/health'));
      expect(res.status).toBe(200);
      const body = await res.json() as Json;
      expect(body).toEqual({ status: 'ok' });
    });
  });

  describe('POST /auth/register', () => {
    it('registers a new user and returns 201', async () => {
      const { status, json } = await t.postJson('/auth/register', {
        email: 'new@test.com',
        identification: 'new@test.com',
        password: 'Secure123!',
      });

      expect(status).toBe(201);
      expect(json.accessToken).toBeTruthy();
      expect(json.tokenType).toBe('Bearer');
      expect((json.user as Json).email).toBe('new@test.com');
    });

    it('returns 422 for invalid email', async () => {
      const { status, json } = await t.postJson('/auth/register', {
        email: 'not-an-email',
        identification: 'not-an-email',
        password: 'Secure123!',
      });

      expect(status).toBe(422);
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('returns 422 for short password', async () => {
      const { status } = await t.postJson('/auth/register', {
        email: 'test@test.com',
        identification: 'test@test.com',
        password: '1234567',
      });

      expect(status).toBe(422);
    });

    it('returns 409 for duplicate email', async () => {
      await t.post('/auth/register', { email: 'dup@test.com', identification: 'dup@test.com', password: 'Secure123!' });

      const { status, json } = await t.postJson('/auth/register', {
        email: 'dup@test.com',
        identification: 'dup@test.com',
        password: 'OtherPass1',
      });

      expect(status).toBe(409);
      expect(json.code).toBe('EMAIL_ALREADY_EXISTS');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await t.post('/auth/register', { email: 'login@test.com', identification: 'login@test.com', password: 'MyPassword1' });
    });

    it('logs in with valid credentials', async () => {
      const { status, json } = await t.postJson('/auth/login', { email: 'login@test.com', password: 'MyPassword1' });

      expect(status).toBe(200);
      expect(json.accessToken).toBeTruthy();
      expect(json.refreshToken).toBeTruthy();
    });

    it('returns 401 for wrong password', async () => {
      const { status, json } = await t.postJson('/auth/login', { email: 'login@test.com', password: 'WrongPassword' });

      expect(status).toBe(401);
      expect(json.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 401 for non-existent email', async () => {
      const { status } = await t.postJson('/auth/login', { email: 'nobody@test.com', password: 'any' });

      expect(status).toBe(401);
    });

    it('returns 422 for missing fields', async () => {
      const { status } = await t.postJson('/auth/login', { email: 'test@test.com' });

      expect(status).toBe(422);
    });
  });

  describe('POST /auth/google', () => {
    it('logs in with valid google token', async () => {
      const { status, json } = await t.postJson('/auth/google', { idToken: 'google-id-token' });

      expect(status).toBe(200);
      expect((json.user as Json).email).toBe('googleuser@gmail.com');
      expect((json.user as Json).authProvider).toBe('google');
    });

    it('returns 401 for invalid google token', async () => {
      const { status } = await t.postJson('/auth/google', { idToken: 'invalid-token' });

      expect(status).toBe(401);
    });

    it('returns 422 for missing idToken', async () => {
      const { status } = await t.postJson('/auth/google', {});

      expect(status).toBe(422);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates tokens', async () => {
      const reg = await (await t.post('/auth/register', { email: 'ref@test.com', identification: 'ref@test.com', password: 'Secure123!' })).json() as Json;

      const { status, json } = await t.postJson('/auth/refresh', { refreshToken: reg.refreshToken });

      expect(status).toBe(200);
      expect(json.accessToken).toBeTruthy();
      expect((json as Json).refreshToken).not.toBe(reg.refreshToken);
    });

    it('returns 401 for invalid refresh token', async () => {
      const { status } = await t.postJson('/auth/refresh', { refreshToken: 'totally-fake' });

      expect(status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('logs out successfully', async () => {
      const reg = await (await t.post('/auth/register', { email: 'out@test.com', identification: 'out@test.com', password: 'Secure123!' })).json() as Json;

      const res = await t.post('/auth/logout', { refreshToken: reg.refreshToken });

      expect(res.status).toBe(204);
    });

    it('returns 204 even for unknown token (idempotent)', async () => {
      const res = await t.post('/auth/logout', { refreshToken: 'unknown' });

      expect(res.status).toBe(204);
    });
  });

  describe('GET /auth/me', () => {
    it('returns user data with valid access token', async () => {
      const reg = await (await t.post('/auth/register', { email: 'me@test.com', identification: 'me@test.com', password: 'Secure123!' })).json() as Json;

      const { status, json } = await t.getJson('/auth/me', reg.accessToken as string);

      expect(status).toBe(200);
      expect(json.email).toBe('me@test.com');
      expect(json.id).toBeTruthy();
    });

    it('returns 401 without token', async () => {
      const { status, json } = await t.getJson('/auth/me');

      expect(status).toBe(401);
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 with invalid token', async () => {
      const { status } = await t.getJson('/auth/me', 'bad-token');

      expect(status).toBe(401);
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await t.app.fetch(new Request('http://localhost/nonexistent'));
      expect(res.status).toBe(404);
      const body = await res.json() as Json;
      expect(body.code).toBe('NOT_FOUND');
    });
  });
});
