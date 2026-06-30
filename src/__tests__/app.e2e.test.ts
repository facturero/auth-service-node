import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../interface/http/app';
import { AppDependencies } from '../interface/http/routes';
import { RegisterWithPasswordUseCase } from '../application/use-cases/register-with-password';
import { LoginWithPasswordUseCase } from '../application/use-cases/login-with-password';
import { LoginWithGoogleUseCase } from '../application/use-cases/login-with-google';
import { RefreshTokenUseCase } from '../application/use-cases/refresh-token';
import { LogoutUseCase } from '../application/use-cases/logout';
import { GetMeUseCase } from '../application/use-cases/get-me';
import {
  InMemoryUnitOfWork,
  InMemoryCredentialRepository,
  InMemoryRefreshTokenRepository,
  MockPasswordHasher,
  MockTokenService,
  MockGoogleVerifier,
} from './helpers';

// ---------------------------------------------------------------------------
// Build the full app with in-memory implementations for E2E testing
// ---------------------------------------------------------------------------

function buildTestApp() {
  const credentials = new InMemoryCredentialRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  // Share the same repo instances with the UnitOfWork so register/google/refresh
  // write to the same stores that login/logout/getMe read from.
  const uow = new InMemoryUnitOfWork({ credentials, refreshTokens });
  const hasher = new MockPasswordHasher();
  const tokenService = new MockTokenService();
  const googleVerifier = new MockGoogleVerifier();

  const deps: AppDependencies = {
    useCases: {
      register: new RegisterWithPasswordUseCase(uow, hasher, tokenService),
      login: new LoginWithPasswordUseCase(
        credentials,
        refreshTokens,
        hasher,
        tokenService,
      ),
      google: new LoginWithGoogleUseCase(googleVerifier, uow, tokenService),
      refresh: new RefreshTokenUseCase(uow, tokenService),
      logout: new LogoutUseCase(refreshTokens, tokenService),
      getMe: new GetMeUseCase(credentials),
    },
    tokenService,
    corsOrigin: '*',
  };

  const app = createApp(deps);

  // Test helpers
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

  return { app, post, get, uow, credentials, refreshTokens, hasher, tokenService, googleVerifier };
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

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  describe('GET /health', () => {
    it('returns ok', async () => {
      const res = await t.app.fetch(new Request('http://localhost/health'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'ok' });
    });
  });

  // -----------------------------------------------------------------------
  // Register
  // -----------------------------------------------------------------------

  describe('POST /auth/register', () => {
    it('registers a new user and returns 201', async () => {
      const res = await t.post('/auth/register', {
        email: 'new@test.com',
        password: 'Secure123!',
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.accessToken).toBeTruthy();
      expect(body.tokenType).toBe('Bearer');
      expect(body.user.email).toBe('new@test.com');
    });

    it('returns 422 for invalid email', async () => {
      const res = await t.post('/auth/register', {
        email: 'not-an-email',
        password: 'Secure123!',
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 422 for short password', async () => {
      const res = await t.post('/auth/register', {
        email: 'test@test.com',
        password: '1234567',
      });

      expect(res.status).toBe(422);
    });

    it('returns 409 for duplicate email', async () => {
      await t.post('/auth/register', { email: 'dup@test.com', password: 'Secure123!' });

      const res = await t.post('/auth/register', {
        email: 'dup@test.com',
        password: 'OtherPass1',
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe('EMAIL_ALREADY_EXISTS');
    });
  });

  // -----------------------------------------------------------------------
  // Login
  // -----------------------------------------------------------------------

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await t.post('/auth/register', { email: 'login@test.com', password: 'MyPassword1' });
    });

    it('logs in with valid credentials', async () => {
      const res = await t.post('/auth/login', { email: 'login@test.com', password: 'MyPassword1' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
    });

    it('returns 401 for wrong password', async () => {
      const res = await t.post('/auth/login', { email: 'login@test.com', password: 'WrongPassword' });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 401 for non-existent email', async () => {
      const res = await t.post('/auth/login', { email: 'nobody@test.com', password: 'any' });

      expect(res.status).toBe(401);
    });

    it('returns 422 for missing fields', async () => {
      const res = await t.post('/auth/login', { email: 'test@test.com' });

      expect(res.status).toBe(422);
    });
  });

  // -----------------------------------------------------------------------
  // Google Auth
  // -----------------------------------------------------------------------

  describe('POST /auth/google', () => {
    it('logs in with valid google token', async () => {
      const res = await t.post('/auth/google', { idToken: 'google-id-token' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe('googleuser@gmail.com');
      expect(body.user.authProvider).toBe('google');
    });

    it('returns 401 for invalid google token', async () => {
      const res = await t.post('/auth/google', { idToken: 'invalid-token' });

      expect(res.status).toBe(401);
    });

    it('returns 422 for missing idToken', async () => {
      const res = await t.post('/auth/google', {});

      expect(res.status).toBe(422);
    });
  });

  // -----------------------------------------------------------------------
  // Refresh
  // -----------------------------------------------------------------------

  describe('POST /auth/refresh', () => {
    it('rotates tokens', async () => {
      const reg = await (await t.post('/auth/register', { email: 'ref@test.com', password: 'Secure123!' })).json();

      const res = await t.post('/auth/refresh', { refreshToken: reg.refreshToken });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).not.toBe(reg.refreshToken);
    });

    it('returns 401 for invalid refresh token', async () => {
      const res = await t.post('/auth/refresh', { refreshToken: 'totally-fake' });

      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // Logout
  // -----------------------------------------------------------------------

  describe('POST /auth/logout', () => {
    it('logs out successfully', async () => {
      const reg = await (await t.post('/auth/register', { email: 'out@test.com', password: 'Secure123!' })).json();

      const res = await t.post('/auth/logout', { refreshToken: reg.refreshToken });

      expect(res.status).toBe(204);
    });

    it('returns 204 even for unknown token (idempotent)', async () => {
      const res = await t.post('/auth/logout', { refreshToken: 'unknown' });

      expect(res.status).toBe(204);
    });
  });

  // -----------------------------------------------------------------------
  // Get Me
  // -----------------------------------------------------------------------

  describe('GET /auth/me', () => {
    it('returns user data with valid access token', async () => {
      const reg = await (await t.post('/auth/register', { email: 'me@test.com', password: 'Secure123!' })).json();

      const res = await t.get('/auth/me', reg.accessToken);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.email).toBe('me@test.com');
      expect(body.id).toBeTruthy();
    });

    it('returns 401 without token', async () => {
      const res = await t.get('/auth/me');

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 with invalid token', async () => {
      const res = await t.get('/auth/me', 'bad-token');

      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // Not Found
  // -----------------------------------------------------------------------

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await t.app.fetch(new Request('http://localhost/nonexistent'));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });
});
