import { DataTypes, InferAttributes, InferCreationAttributes, Model } from 'sequelize';
import { sequelize } from './sequelize';

/**
 * Modelos de Sequelize (capa de persistencia). Mapean 1:1 con las tablas de
 * `auth_db`. Los repositorios convierten entre estos modelos y las entidades
 * de dominio; el resto de la app no debería importar estos modelos.
 *
 * `underscored: true` (definido en la conexión) usa snake_case en columnas.
 * Las marcas de tiempo se gestionan de forma explícita (timestamps: false):
 * las entidades y repositorios setean created_at/updated_at.
 */

export class CredentialModel extends Model<
  InferAttributes<CredentialModel>,
  InferCreationAttributes<CredentialModel>
> {
  declare id: string;
  declare user_id: string;
  declare email: string;
  declare password_hash: string | null;
  declare email_verified: boolean;
  declare status: 'active' | 'disabled';
  declare created_at: Date;
  declare updated_at: Date;
}

CredentialModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    user_id: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING(255), allowNull: true },
    email_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.ENUM('active', 'disabled'), allowNull: false, defaultValue: 'active' },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'credentials', timestamps: false },
);

export class OAuthAccountModel extends Model<
  InferAttributes<OAuthAccountModel>,
  InferCreationAttributes<OAuthAccountModel>
> {
  declare id: string;
  declare credential_id: string;
  declare provider: string;
  declare provider_user_id: string;
  declare email: string;
  declare created_at: Date;
}

OAuthAccountModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    credential_id: { type: DataTypes.CHAR(36), allowNull: false },
    provider: { type: DataTypes.STRING(20), allowNull: false },
    provider_user_id: { type: DataTypes.STRING(255), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false },
    created_at: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'oauth_accounts',
    timestamps: false,
    indexes: [{ unique: true, fields: ['provider', 'provider_user_id'] }],
  },
);

export class RefreshTokenModel extends Model<
  InferAttributes<RefreshTokenModel>,
  InferCreationAttributes<RefreshTokenModel>
> {
  declare id: string;
  declare credential_id: string;
  declare token_hash: string;
  declare expires_at: Date;
  declare revoked_at: Date | null;
  declare replaced_by: string | null;
  declare user_agent: string | null;
  declare ip: string | null;
  declare created_at: Date;
}

RefreshTokenModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    credential_id: { type: DataTypes.CHAR(36), allowNull: false },
    token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked_at: { type: DataTypes.DATE, allowNull: true },
    replaced_by: { type: DataTypes.CHAR(36), allowNull: true },
    user_agent: { type: DataTypes.STRING(255), allowNull: true },
    ip: { type: DataTypes.STRING(45), allowNull: true },
    created_at: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'refresh_tokens',
    timestamps: false,
    indexes: [{ fields: ['credential_id'] }],
  },
);

export class OutboxModel extends Model<
  InferAttributes<OutboxModel>,
  InferCreationAttributes<OutboxModel>
> {
  declare id: string;
  declare aggregate_type: string;
  declare aggregate_id: string;
  declare type: string;
  declare payload: unknown;
  declare occurred_at: Date;
  declare processed_at: Date | null;
}

OutboxModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    aggregate_type: { type: DataTypes.STRING(50), allowNull: false },
    aggregate_id: { type: DataTypes.CHAR(36), allowNull: false },
    type: { type: DataTypes.STRING(100), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false },
    occurred_at: { type: DataTypes.DATE, allowNull: false },
    processed_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: 'outbox_messages',
    timestamps: false,
    indexes: [{ fields: ['processed_at'] }],
  },
);

// ---------------------------------------------------------------------------
// RBAC models
// ---------------------------------------------------------------------------

export class UserModel extends Model<
  InferAttributes<UserModel>,
  InferCreationAttributes<UserModel>
> {
  declare id: string;
  declare email: string;
  declare identification: string | null;
  declare full_name: string | null;
  declare status: 'active' | 'disabled';
  declare is_platform_admin: boolean;
  declare permissions_version: number;
  declare created_at: Date;
  declare updated_at: Date;
}

UserModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    identification: { type: DataTypes.STRING(20), allowNull: true, unique: true },
    full_name: { type: DataTypes.STRING(255), allowNull: true },
    status: { type: DataTypes.ENUM('active', 'disabled'), allowNull: false, defaultValue: 'active' },
    is_platform_admin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    permissions_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'users', timestamps: false },
);

export class OrganizationModel extends Model<
  InferAttributes<OrganizationModel>,
  InferCreationAttributes<OrganizationModel>
> {
  declare id: string;
  declare country_code: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

OrganizationModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    country_code: { type: DataTypes.STRING(2), allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'organizations', timestamps: false },
);

export class PermissionModel extends Model<
  InferAttributes<PermissionModel>,
  InferCreationAttributes<PermissionModel>
> {
  declare id: string;
  declare code: string;
  declare resource: string;
  declare action: string;
  declare description: string | null;
}

PermissionModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    code: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    resource: { type: DataTypes.STRING(50), allowNull: false },
    action: { type: DataTypes.STRING(50), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
  },
  { sequelize, tableName: 'permissions', timestamps: false },
);

export class RoleModel extends Model<
  InferAttributes<RoleModel>,
  InferCreationAttributes<RoleModel>
> {
  declare id: string;
  declare organization_id: string | null;
  declare name: string;
  declare description: string | null;
  declare is_system: boolean;
  declare created_at: Date;
  declare updated_at: Date;
}

RoleModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    organization_id: { type: DataTypes.CHAR(36), allowNull: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'roles',
    timestamps: false,
    indexes: [{ unique: true, fields: ['organization_id', 'name'] }],
  },
);

export class RolePermissionModel extends Model<
  InferAttributes<RolePermissionModel>,
  InferCreationAttributes<RolePermissionModel>
> {
  declare role_id: string;
  declare permission_id: string;
}

RolePermissionModel.init(
  {
    role_id: { type: DataTypes.CHAR(36), primaryKey: true, allowNull: false },
    permission_id: { type: DataTypes.CHAR(36), primaryKey: true, allowNull: false },
  },
  { sequelize, tableName: 'role_permissions', timestamps: false },
);

export class UserRoleModel extends Model<
  InferAttributes<UserRoleModel>,
  InferCreationAttributes<UserRoleModel>
> {
  declare id: string;
  declare user_id: string;
  declare organization_id: string;
  declare role_id: string;
  declare created_at: Date;
}

UserRoleModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    user_id: { type: DataTypes.CHAR(36), allowNull: false },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    role_id: { type: DataTypes.CHAR(36), allowNull: false },
    created_at: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'user_roles',
    timestamps: false,
    indexes: [{ unique: true, fields: ['user_id', 'organization_id', 'role_id'] }],
  },
);

export class MembershipModel extends Model<
  InferAttributes<MembershipModel>,
  InferCreationAttributes<MembershipModel>
> {
  declare id: string;
  declare user_id: string;
  declare organization_id: string;
  declare status: 'active' | 'invited' | 'disabled';
  declare created_at: Date;
  declare updated_at: Date;
}

MembershipModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    user_id: { type: DataTypes.CHAR(36), allowNull: false },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    status: { type: DataTypes.ENUM('active', 'invited', 'disabled'), allowNull: false, defaultValue: 'active' },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'organization_memberships',
    timestamps: false,
    indexes: [{ unique: true, fields: ['user_id', 'organization_id'] }],
  },
);

// Asociaciones
CredentialModel.hasMany(OAuthAccountModel, { foreignKey: 'credential_id' });
OAuthAccountModel.belongsTo(CredentialModel, { foreignKey: 'credential_id' });
CredentialModel.hasMany(RefreshTokenModel, { foreignKey: 'credential_id' });
RefreshTokenModel.belongsTo(CredentialModel, { foreignKey: 'credential_id' });
CredentialModel.belongsTo(UserModel, { foreignKey: 'user_id' });
UserModel.hasOne(CredentialModel, { foreignKey: 'user_id' });
