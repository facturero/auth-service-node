import { randomUUID } from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from './sequelize';
import {
  CredentialModel,
  MembershipModel,
  OAuthAccountModel,
  OrganizationModel,
  OutboxModel,
  PermissionModel,
  RefreshTokenModel,
  RoleModel,
  RolePermissionModel,
  UserModel,
  UserRoleModel,
} from './models';
import { Credential, OAuthAccount, OAuthProvider, RefreshToken } from '../../domain/entities';
import { User, Organization, Role, Permission, Membership, UserRole } from '../../domain/rbac';
import {
  AccessQuery,
  CredentialRepository,
  DomainEvent,
  MembershipRepository,
  OAuthAccountRepository,
  OrganizationRepository,
  OutboxRepository,
  PermissionRepository,
  RefreshTokenRepository,
  Repositories,
  RoleRepository,
  UserRepository,
  UserRoleRepository,
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

// --------------------------- RBAC Mappers ------------------------------------

function toUser(m: UserModel): User {
  return User.fromPersistence({
    id: m.id,
    email: m.email,
    identification: m.identification,
    fullName: m.full_name,
    avatarFileId: m.avatar_file_id,
    status: m.status,
    isPlatformAdmin: m.is_platform_admin,
    permissionsVersion: m.permissions_version,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function toOrganization(m: OrganizationModel): Organization {
  return Organization.fromPersistence({
    id: m.id,
    countryCode: m.country_code,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function toRole(m: RoleModel): Role {
  return Role.fromPersistence({
    id: m.id,
    organizationId: m.organization_id,
    name: m.name,
    description: m.description,
    isSystem: m.is_system,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function toPermission(m: PermissionModel): Permission {
  return Permission.fromPersistence({
    id: m.id,
    code: m.code,
    resource: m.resource,
    action: m.action,
    description: m.description,
  });
}

function toMembership(m: MembershipModel): Membership {
  return Membership.fromPersistence({
    id: m.id,
    userId: m.user_id,
    organizationId: m.organization_id,
    status: m.status,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function toUserRole(m: UserRoleModel): UserRole {
  return UserRole.fromPersistence({
    id: m.id,
    userId: m.user_id,
    organizationId: m.organization_id,
    roleId: m.role_id,
    createdAt: m.created_at,
  });
}

// --------------------------- RBAC Repositorios -------------------------------

function userRepository(tx?: Transaction): UserRepository {
  return {
    async findById(id) {
      const m = await UserModel.findByPk(id, { transaction: tx });
      return m ? toUser(m) : null;
    },
    async findByEmail(email) {
      const m = await UserModel.findOne({ where: { email }, transaction: tx });
      return m ? toUser(m) : null;
    },
    async findByIdentification(identification) {
      const m = await UserModel.findOne({ where: { identification }, transaction: tx });
      return m ? toUser(m) : null;
    },
    async save(user) {
      const p = user.toPersistence();
      await UserModel.upsert(
        {
          id: p.id,
          email: p.email,
          identification: p.identification,
          full_name: p.fullName,
          avatar_file_id: p.avatarFileId,
          status: p.status,
          is_platform_admin: p.isPlatformAdmin,
          permissions_version: p.permissionsVersion,
          created_at: p.createdAt,
          updated_at: new Date(),
        },
        { transaction: tx },
      );
    },
    async incrementPermissionsVersion(userId) {
      await UserModel.increment('permissions_version', {
        by: 1,
        where: { id: userId },
        transaction: tx,
      });
    },
    async listByOrganization(organizationId) {
      const rows = await sequelize.query<UserModel>(
        `SELECT u.* FROM users u
          JOIN organization_memberships om ON om.user_id = u.id
         WHERE om.organization_id = :organizationId`,
        { replacements: { organizationId }, type: QueryTypes.SELECT, transaction: tx },
      );
      return rows.map(toUser);
    },
  };
}

function roleRepository(tx?: Transaction): RoleRepository {
  return {
    async findById(id) {
      const m = await RoleModel.findByPk(id, { transaction: tx });
      return m ? toRole(m) : null;
    },
    async findTemplates() {
      const rows = await RoleModel.findAll({ where: { organization_id: null }, transaction: tx });
      return rows.map(toRole);
    },
    async findByOrganization(organizationId) {
      const rows = await RoleModel.findAll({ where: { organization_id: organizationId }, transaction: tx });
      return rows.map(toRole);
    },
    async save(role) {
      const p = role.toPersistence();
      await RoleModel.upsert(
        {
          id: p.id,
          organization_id: p.organizationId,
          name: p.name,
          description: p.description,
          is_system: p.isSystem,
          created_at: p.createdAt,
          updated_at: new Date(),
        },
        { transaction: tx },
      );
    },
    async setPermissions(roleId, permissionIds) {
      await RolePermissionModel.destroy({ where: { role_id: roleId }, transaction: tx });
      if (permissionIds.length > 0) {
        await RolePermissionModel.bulkCreate(
          permissionIds.map((permissionId) => ({ role_id: roleId, permission_id: permissionId })),
          { transaction: tx },
        );
      }
    },
    async getPermissionCodes(roleId) {
      const rows = await sequelize.query<{ code: string }>(
        `SELECT p.code FROM role_permissions rp
          JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = :roleId`,
        { replacements: { roleId }, type: QueryTypes.SELECT, transaction: tx },
      );
      return rows.map((r) => r.code);
    },
  };
}

function permissionRepository(tx?: Transaction): PermissionRepository {
  return {
    async findAll() {
      const rows = await PermissionModel.findAll({ transaction: tx });
      return rows.map(toPermission);
    },
    async findIdsByCodes(codes) {
      const rows = await PermissionModel.findAll({
        where: { code: codes },
        attributes: ['id', 'code'],
        transaction: tx,
      });
      return rows.map((r) => r.id);
    },
  };
}

function membershipRepository(tx?: Transaction): MembershipRepository {
  return {
    async find(userId, organizationId) {
      const m = await MembershipModel.findOne({
        where: { user_id: userId, organization_id: organizationId },
        transaction: tx,
      });
      return m ? toMembership(m) : null;
    },
    async listActiveByUser(userId) {
      const rows = await MembershipModel.findAll({
        where: { user_id: userId, status: 'active' },
        transaction: tx,
      });
      return rows.map(toMembership);
    },
    async save(m) {
      const p = m.toPersistence();
      await MembershipModel.upsert(
        {
          id: p.id,
          user_id: p.userId,
          organization_id: p.organizationId,
          status: p.status,
          created_at: p.createdAt,
          updated_at: new Date(),
        },
        { transaction: tx },
      );
    },
  };
}

function userRoleRepository(tx?: Transaction): UserRoleRepository {
  return {
    async assign(userRole) {
      const p = userRole.toPersistence();
      await UserRoleModel.create(
        {
          id: p.id,
          user_id: p.userId,
          organization_id: p.organizationId,
          role_id: p.roleId,
          created_at: p.createdAt,
        },
        { transaction: tx },
      );
    },
    async remove(userId, organizationId, roleId) {
      await UserRoleModel.destroy({
        where: { user_id: userId, organization_id: organizationId, role_id: roleId },
        transaction: tx,
      });
    },
    async listByUserAndOrg(userId, organizationId) {
      const rows = await UserRoleModel.findAll({
        where: { user_id: userId, organization_id: organizationId },
        transaction: tx,
      });
      return rows.map(toUserRole);
    },
    async listUserIdsByRole(roleId) {
      const rows = await UserRoleModel.findAll({
        where: { role_id: roleId },
        attributes: ['user_id'],
        transaction: tx,
      });
      return rows.map((r) => r.user_id);
    },
  };
}

// --------------------------- AccessQuery -------------------------------------

export const sequelizeAccessQuery: AccessQuery = {
  async effectivePermissions(userId, organizationId) {
    const rows = await sequelize.query<{ code: string }>(
      `SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p       ON p.id = rp.permission_id
        WHERE ur.user_id = :userId AND ur.organization_id = :organizationId`,
      { replacements: { userId, organizationId }, type: QueryTypes.SELECT },
    );
    return rows.map((r) => r.code);
  },
  async countryCodeOf(organizationId) {
    const rows = await sequelize.query<{ country_code: string | null }>(
      `SELECT country_code FROM organizations WHERE id = :organizationId LIMIT 1`,
      { replacements: { organizationId }, type: QueryTypes.SELECT },
    );
    return rows[0]?.country_code ?? null;
  },
};

function organizationRepository(tx?: Transaction): OrganizationRepository {
  return {
    async findById(id) {
      const m = await OrganizationModel.findByPk(id, { transaction: tx });
      return m ? toOrganization(m) : null;
    },
    async save(org) {
      const p = org.toPersistence();
      await OrganizationModel.upsert(
        {
          id: p.id,
          country_code: p.countryCode,
          created_at: p.createdAt,
          updated_at: new Date(),
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
    users: userRepository(tx),
    organizations: organizationRepository(tx),
    roles: roleRepository(tx),
    permissions: permissionRepository(tx),
    memberships: membershipRepository(tx),
    userRoles: userRoleRepository(tx),
  };
}

// --------------------------- Unit of Work -----------------------------------

export class SequelizeUnitOfWork implements UnitOfWork {
  async execute<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    // Transacción gestionada: commit si resuelve, rollback si lanza.
    return sequelize.transaction(async (tx) => work(buildRepositories(tx)));
  }
}
