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

// Asociaciones (solo a nivel de modelo; no se usan JOINs entre servicios).
CredentialModel.hasMany(OAuthAccountModel, { foreignKey: 'credential_id' });
OAuthAccountModel.belongsTo(CredentialModel, { foreignKey: 'credential_id' });
CredentialModel.hasMany(RefreshTokenModel, { foreignKey: 'credential_id' });
RefreshTokenModel.belongsTo(CredentialModel, { foreignKey: 'credential_id' });
