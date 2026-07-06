import { Credential, OAuthAccount, OAuthProvider, RefreshToken } from './entities';
import { User, Organization, Role, Permission, Membership, UserRole } from './rbac';

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
  listByUserAndOrg(userId: string, organizationId: string): Promise<UserRole[]>;
  listUserIdsByRole(roleId: string): Promise<string[]>;
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
  outbox: OutboxRepository;
  users: UserRepository;
  organizations: OrganizationRepository;
  roles: RoleRepository;
  permissions: PermissionRepository;
  memberships: MembershipRepository;
  userRoles: UserRoleRepository;
}
