import {
  Credential,
  OAuthAccount,
  OAuthProvider,
  RefreshToken,
  PosDevice,
  DeviceRefreshToken,
  PasswordResetToken,
} from './entities';
import { User, Organization, Role, Permission, Membership, UserRole, UserEstablishment } from './rbac';

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
  /** Revoca todas las sesiones activas de una credencial (ej. al resetear contraseña). */
  revokeAllByCredentialId(credentialId: string): Promise<void>;
}

export interface PosDeviceRepository {
  findById(id: string): Promise<PosDevice | null>;
  findByEmissionPointId(emissionPointId: string): Promise<PosDevice | null>;
  save(device: PosDevice): Promise<void>;
}

export interface DeviceRefreshTokenRepository {
  findByHash(tokenHash: string): Promise<DeviceRefreshToken | null>;
  save(token: DeviceRefreshToken): Promise<void>;
}

export interface PasswordResetTokenRepository {
  findByHash(tokenHash: string): Promise<PasswordResetToken | null>;
  save(token: PasswordResetToken): Promise<void>;
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

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByIdentification(identification: string): Promise<User | null>;
  save(user: User): Promise<void>;
  incrementPermissionsVersion(userId: string): Promise<void>;
  listByOrganization(organizationId: string): Promise<User[]>;
}

export interface OrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  save(org: Organization): Promise<void>;
}

export interface RoleRepository {
  findById(id: string): Promise<Role | null>;
  findTemplates(): Promise<Role[]>;
  findByOrganization(organizationId: string): Promise<Role[]>;
  save(role: Role): Promise<void>;
  setPermissions(roleId: string, permissionIds: string[]): Promise<void>;
  getPermissionCodes(roleId: string): Promise<string[]>;
}

export interface PermissionRepository {
  findAll(): Promise<Permission[]>;
  findIdsByCodes(codes: string[]): Promise<string[]>;
}

export interface MembershipRepository {
  find(userId: string, organizationId: string): Promise<Membership | null>;
  listActiveByUser(userId: string): Promise<Membership[]>;
  save(m: Membership): Promise<void>;
}

export interface UserRoleRepository {
  assign(userRole: UserRole): Promise<void>;
  remove(userId: string, organizationId: string, roleId: string): Promise<void>;
  removeAllByUser(userId: string, organizationId: string): Promise<void>;
  listByUserAndOrg(userId: string, organizationId: string): Promise<UserRole[]>;
  listUserIdsByRole(roleId: string): Promise<string[]>;
}

export interface UserEstablishmentRepository {
  listByUser(userId: string): Promise<UserEstablishment[]>;
  listUserIdsByEstablishment(establishmentId: string): Promise<string[]>;
  /** Reemplaza todas las asignaciones del usuario por las dadas (delete + insert). */
  replaceForUser(userId: string, establishmentIds: string[]): Promise<void>;
}

export interface TrustedIp {
  id: string;
  ip: string;
  label: string | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TrustedIpRepository {
  findAll(): Promise<TrustedIp[]>;
  findEnabled(): Promise<TrustedIp[]>;
  findByIp(ip: string): Promise<TrustedIp | null>;
  create(data: Omit<TrustedIp, 'created_at' | 'updated_at'>): Promise<TrustedIp>;
  update(id: string, data: Partial<Pick<TrustedIp, 'ip' | 'label' | 'enabled'>>): Promise<TrustedIp | null>;
  delete(id: string): Promise<boolean>;
}

export interface AccessQuery {
  effectivePermissions(userId: string, organizationId: string): Promise<string[]>;
  countryCodeOf(organizationId: string): Promise<string | null>;
}

/**
 * Conjunto de repositorios. La UnitOfWork entrega una instancia de este
 * agregado ligada a una transacción para operaciones atómicas.
 */
export interface Repositories {
  credentials: CredentialRepository;
  oauthAccounts: OAuthAccountRepository;
  refreshTokens: RefreshTokenRepository;
  posDevices: PosDeviceRepository;
  deviceRefreshTokens: DeviceRefreshTokenRepository;
  passwordResetTokens: PasswordResetTokenRepository;
  outbox: OutboxRepository;
  users: UserRepository;
  organizations: OrganizationRepository;
  roles: RoleRepository;
  permissions: PermissionRepository;
  memberships: MembershipRepository;
  userRoles: UserRoleRepository;
  userEstablishments: UserEstablishmentRepository;
  trustedIps: TrustedIpRepository;
}
