import { Credential, OAuthAccount, OAuthProvider, RefreshToken } from './entities';

/**
 * Puertos de persistencia (interfaces). La capa de aplicación depende de
 * estas abstracciones; la infraestructura (Sequelize) las implementa.
 *
 * Convención: `save` hace upsert (inserta o actualiza según exista el id).
 */

export interface CredentialRepository {
  findById(id: string): Promise<Credential | null>;
  findByUserId(userId: string): Promise<Credential | null>;
  findByEmail(email: string): Promise<Credential | null>;
  save(credential: Credential): Promise<void>;
}

export interface OAuthAccountRepository {
  findByProvider(provider: OAuthProvider, providerUserId: string): Promise<OAuthAccount | null>;
  save(account: OAuthAccount): Promise<void>;
}

export interface RefreshTokenRepository {
  findByHash(tokenHash: string): Promise<RefreshToken | null>;
  save(token: RefreshToken): Promise<void>;
}

/**
 * Evento de dominio que se persiste en la tabla outbox dentro de la misma
 * transacción que el cambio de estado (patrón Outbox). Un relay posterior
 * (fuera del alcance de este MVP) los publica en RabbitMQ.
 */
export interface DomainEvent {
  type: string; // ej. 'auth.credential.registered'
  aggregateType: string; // ej. 'credential'
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface OutboxRepository {
  add(event: DomainEvent): Promise<void>;
}

/**
 * Conjunto de repositorios. La UnitOfWork entrega una instancia de este
 * agregado ligada a una transacción para operaciones atómicas.
 */
export interface Repositories {
  credentials: CredentialRepository;
  oauthAccounts: OAuthAccountRepository;
  refreshTokens: RefreshTokenRepository;
  outbox: OutboxRepository;
}
