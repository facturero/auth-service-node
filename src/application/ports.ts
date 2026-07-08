import { Repositories } from '../domain/repositories';

/**
 * Puertos de infraestructura que la capa de aplicación necesita pero NO
 * implementa. La infraestructura provee las implementaciones concretas
 * (argon2, jose, google-auth-library, Sequelize).
 */

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

export interface AccessTokenClaims {
  sub: string;            // user_id
  email: string;
  orgId: string | null;         // organización activa (null si no tiene membership)
  countryCode: string | null;   // país de la org activa
  permissions: string[];        // ['customer:read', ...]
  pv: number;                   // permissions_version
}

export interface AccessContext {
  orgId: string | null;
  countryCode: string | null;
  permissions: string[];
  pv: number;
}

export interface AccessContextResolver {
  /** Resuelve el contexto de acceso del usuario para su organización activa. */
  resolve(userId: string, preferredOrgId?: string | null): Promise<AccessContext>;
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number; // segundos
}

export interface GeneratedRefreshToken {
  token: string; // valor opaco que recibe el cliente
  hash: string; // lo que se persiste
  expiresAt: Date;
}

export interface TokenService {
  issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;
  generateRefreshToken(): GeneratedRefreshToken;
  hashRefreshToken(token: string): string;
}

export interface GoogleProfile {
  sub: string; // identificador estable del usuario en Google
  email: string;
  emailVerified: boolean;
  name?: string;
}

export interface GoogleIdTokenVerifier {
  verify(idToken: string): Promise<GoogleProfile>;
}

export interface InviteTokenPayload {
  userId: string;
  email: string;
  organizationId: string;
}

export interface InviteTokenService {
  generateInviteToken(payload: InviteTokenPayload): string;
}

/**
 * Unidad de trabajo: ejecuta `work` dentro de una transacción y le entrega
 * un conjunto de repositorios ligados a ella. Si `work` lanza, se hace rollback.
 */
export interface UnitOfWork {
  execute<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
