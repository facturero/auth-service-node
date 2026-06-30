import { randomUUID } from 'node:crypto';
import { Email, UserId } from './value-objects';

/**
 * Entidades del dominio. Modelan el estado y las reglas de la autenticación.
 * Las entidades NO conocen la base de datos: los repositorios las mapean
 * desde/hacia los modelos de persistencia.
 */

export type CredentialStatus = 'active' | 'disabled';
export type OAuthProvider = 'google';

// ---------------------------------------------------------------------------
// Credential: la identidad de acceso (email + posible contraseña).
// ---------------------------------------------------------------------------
export interface CredentialProps {
  id: string;
  userId: string;
  email: string;
  passwordHash: string | null;
  emailVerified: boolean;
  status: CredentialStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class Credential {
  private constructor(private props: CredentialProps) {}

  /** Crea una cuenta con contraseña (aún no verificada). */
  static createWithPassword(params: { email: Email; passwordHash: string }): Credential {
    const now = new Date();
    return new Credential({
      id: randomUUID(),
      userId: UserId.generate().value,
      email: params.email.value,
      passwordHash: params.passwordHash,
      emailVerified: false,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Crea una cuenta a partir de Google (sin contraseña). */
  static createWithGoogle(params: { email: Email; emailVerified: boolean }): Credential {
    const now = new Date();
    return new Credential({
      id: randomUUID(),
      userId: UserId.generate().value,
      email: params.email.value,
      passwordHash: null,
      emailVerified: params.emailVerified,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Reconstituye una entidad desde persistencia. */
  static fromPersistence(props: CredentialProps): Credential {
    return new Credential({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get email(): string {
    return this.props.email;
  }
  get passwordHash(): string | null {
    return this.props.passwordHash;
  }
  get emailVerified(): boolean {
    return this.props.emailVerified;
  }
  get status(): CredentialStatus {
    return this.props.status;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  hasPassword(): boolean {
    return this.props.passwordHash !== null;
  }

  isActive(): boolean {
    return this.props.status === 'active';
  }

  markEmailVerified(): void {
    this.props.emailVerified = true;
    this.props.updatedAt = new Date();
  }

  toPersistence(): CredentialProps {
    return { ...this.props };
  }
}

// ---------------------------------------------------------------------------
// OAuthAccount: vínculo entre una credencial y un proveedor externo (Google).
// ---------------------------------------------------------------------------
export interface OAuthAccountProps {
  id: string;
  credentialId: string;
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
  createdAt: Date;
}

export class OAuthAccount {
  private constructor(private props: OAuthAccountProps) {}

  static create(params: {
    credentialId: string;
    provider: OAuthProvider;
    providerUserId: string;
    email: string;
  }): OAuthAccount {
    return new OAuthAccount({
      id: randomUUID(),
      credentialId: params.credentialId,
      provider: params.provider,
      providerUserId: params.providerUserId,
      email: params.email,
      createdAt: new Date(),
    });
  }

  static fromPersistence(props: OAuthAccountProps): OAuthAccount {
    return new OAuthAccount({ ...props });
  }

  get credentialId(): string {
    return this.props.credentialId;
  }
  get provider(): OAuthProvider {
    return this.props.provider;
  }
  get providerUserId(): string {
    return this.props.providerUserId;
  }

  toPersistence(): OAuthAccountProps {
    return { ...this.props };
  }
}

// ---------------------------------------------------------------------------
// RefreshToken: sesión renovable. En la base vive solo el HASH del token.
// ---------------------------------------------------------------------------
export interface RefreshTokenProps {
  id: string;
  credentialId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
}

export class RefreshToken {
  private constructor(private props: RefreshTokenProps) {}

  static issue(params: {
    credentialId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }): RefreshToken {
    return new RefreshToken({
      id: randomUUID(),
      credentialId: params.credentialId,
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
      revokedAt: null,
      replacedBy: null,
      userAgent: params.userAgent ?? null,
      ip: params.ip ?? null,
      createdAt: new Date(),
    });
  }

  static fromPersistence(props: RefreshTokenProps): RefreshToken {
    return new RefreshToken({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get credentialId(): string {
    return this.props.credentialId;
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  isActive(now: Date = new Date()): boolean {
    return this.props.revokedAt === null && this.props.expiresAt.getTime() > now.getTime();
  }

  /** Revoca el token, opcionalmente apuntando al que lo reemplaza (rotación). */
  revoke(replacedById: string | null = null): void {
    if (this.props.revokedAt === null) {
      this.props.revokedAt = new Date();
    }
    this.props.replacedBy = replacedById;
  }

  toPersistence(): RefreshTokenProps {
    return { ...this.props };
  }
}
