import { randomUUID } from 'node:crypto';
import { Transaction } from 'sequelize';
import { sequelize } from './sequelize';
import {
  CredentialModel,
  OAuthAccountModel,
  OutboxModel,
  RefreshTokenModel,
} from './models';
import { Credential, OAuthAccount, OAuthProvider, RefreshToken } from '../../domain/entities';
import {
  CredentialRepository,
  DomainEvent,
  OAuthAccountRepository,
  OutboxRepository,
  RefreshTokenRepository,
  Repositories,
} from '../../domain/repositories';
import { UnitOfWork } from '../../application/ports';

// --------------------------- Mappers (modelo <-> dominio) -------------------

function toCredential(m: CredentialModel): Credential {
  return Credential.fromPersistence({
    id: m.id,
    userId: m.user_id,
    email: m.email,
    passwordHash: m.password_hash,
    emailVerified: m.email_verified,
    status: m.status,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function toOAuthAccount(m: OAuthAccountModel): OAuthAccount {
  return OAuthAccount.fromPersistence({
    id: m.id,
    credentialId: m.credential_id,
    provider: m.provider as OAuthProvider,
    providerUserId: m.provider_user_id,
    email: m.email,
    createdAt: m.created_at,
  });
}

function toRefreshToken(m: RefreshTokenModel): RefreshToken {
  return RefreshToken.fromPersistence({
    id: m.id,
    credentialId: m.credential_id,
    tokenHash: m.token_hash,
    expiresAt: m.expires_at,
    revokedAt: m.revoked_at,
    replacedBy: m.replaced_by,
    userAgent: m.user_agent,
    ip: m.ip,
    createdAt: m.created_at,
  });
}

// --------------------------- Repositorios -----------------------------------

function credentialRepository(tx?: Transaction): CredentialRepository {
  return {
    async findById(id) {
      const m = await CredentialModel.findByPk(id, { transaction: tx });
      return m ? toCredential(m) : null;
    },
    async findByUserId(userId) {
      const m = await CredentialModel.findOne({ where: { user_id: userId }, transaction: tx });
      return m ? toCredential(m) : null;
    },
    async findByEmail(email) {
      const m = await CredentialModel.findOne({ where: { email }, transaction: tx });
      return m ? toCredential(m) : null;
    },
    async save(credential) {
      const p = credential.toPersistence();
      await CredentialModel.upsert(
        {
          id: p.id,
          user_id: p.userId,
          email: p.email,
          password_hash: p.passwordHash,
          email_verified: p.emailVerified,
          status: p.status,
          created_at: p.createdAt,
          updated_at: new Date(),
        },
        { transaction: tx },
      );
    },
  };
}

function oauthAccountRepository(tx?: Transaction): OAuthAccountRepository {
  return {
    async findByProvider(provider, providerUserId) {
      const m = await OAuthAccountModel.findOne({
        where: { provider, provider_user_id: providerUserId },
        transaction: tx,
      });
      return m ? toOAuthAccount(m) : null;
    },
    async save(account) {
      const p = account.toPersistence();
      await OAuthAccountModel.upsert(
        {
          id: p.id,
          credential_id: p.credentialId,
          provider: p.provider,
          provider_user_id: p.providerUserId,
          email: p.email,
          created_at: p.createdAt,
        },
        { transaction: tx },
      );
    },
  };
}

function refreshTokenRepository(tx?: Transaction): RefreshTokenRepository {
  return {
    async findByHash(tokenHash) {
      const m = await RefreshTokenModel.findOne({ where: { token_hash: tokenHash }, transaction: tx });
      return m ? toRefreshToken(m) : null;
    },
    async save(token) {
      const p = token.toPersistence();
      await RefreshTokenModel.upsert(
        {
          id: p.id,
          credential_id: p.credentialId,
          token_hash: p.tokenHash,
          expires_at: p.expiresAt,
          revoked_at: p.revokedAt,
          replaced_by: p.replacedBy,
          user_agent: p.userAgent,
          ip: p.ip,
          created_at: p.createdAt,
        },
        { transaction: tx },
      );
    },
  };
}

function outboxRepository(tx?: Transaction): OutboxRepository {
  return {
    async add(event: DomainEvent) {
      await OutboxModel.create(
        {
          id: randomUUID(),
          aggregate_type: event.aggregateType,
          aggregate_id: event.aggregateId,
          type: event.type,
          payload: event.payload,
          occurred_at: event.occurredAt,
          processed_at: null,
        },
        { transaction: tx },
      );
    },
  };
}

/** Construye el conjunto de repositorios, opcionalmente ligados a una transacción. */
export function buildRepositories(tx?: Transaction): Repositories {
  return {
    credentials: credentialRepository(tx),
    oauthAccounts: oauthAccountRepository(tx),
    refreshTokens: refreshTokenRepository(tx),
    outbox: outboxRepository(tx),
  };
}

// --------------------------- Unit of Work -----------------------------------

export class SequelizeUnitOfWork implements UnitOfWork {
  async execute<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    // Transacción gestionada: commit si resuelve, rollback si lanza.
    return sequelize.transaction(async (tx) => work(buildRepositories(tx)));
  }
}
