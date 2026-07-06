/**
 * DTOs de entrada/salida de los casos de uso. Son contratos de la capa de
 * aplicación, independientes del transporte HTTP.
 */

export interface RegisterInput {
  email: string;
  password: string;
  identification: string;
  userAgent?: string | null;
  ip?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
}

export interface GoogleAuthInput {
  idToken: string;
  identification?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}

export interface RefreshInput {
  refreshToken: string;
  userAgent?: string | null;
  ip?: string | null;
}

export interface LogoutInput {
  refreshToken: string;
}

export type AuthProvider = 'password' | 'google';

export interface UserSummary {
  id: string; // user_id
  email: string;
  emailVerified: boolean;
  authProvider: AuthProvider;
}

export interface SessionOutput {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshToken: string;
  isNewUser?: boolean;
  needsOrg?: boolean;
  organizationId?: string;
  user: UserSummary;
}

export interface MeOutput {
  id: string;
  email: string;
  emailVerified: boolean;
  authProvider: AuthProvider;
  createdAt: string; // ISO
}
