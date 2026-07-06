import { randomUUID } from 'node:crypto';

export type UserStatus = 'active' | 'disabled';
export type MembershipStatus = 'active' | 'invited' | 'disabled';

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------
export interface UserProps {
  id: string;
  email: string;
  identification: string | null;
  fullName: string | null;
  avatarFileId: string | null;
  status: UserStatus;
  isPlatformAdmin: boolean;
  permissionsVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  private constructor(private props: UserProps) {}

  static create(params: { id?: string; email: string; identification?: string | null; fullName?: string | null }): User {
    const now = new Date();
    return new User({
      id: params.id ?? randomUUID(),
      email: params.email,
      identification: params.identification ?? null,
      fullName: params.fullName ?? null,
      avatarFileId: null,
      status: 'active',
      isPlatformAdmin: false,
      permissionsVersion: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: UserProps): User {
    return new User({ ...props });
  }

  get id(): string { return this.props.id; }
  get email(): string { return this.props.email; }
  get identification(): string | null { return this.props.identification; }
  get fullName(): string | null { return this.props.fullName; }
  get avatarFileId(): string | null { return this.props.avatarFileId; }
  get status(): UserStatus { return this.props.status; }
  get isPlatformAdmin(): boolean { return this.props.isPlatformAdmin; }
  get permissionsVersion(): number { return this.props.permissionsVersion; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  isActive(): boolean {
    return this.props.status === 'active';
  }

  disable(): void {
    this.props.status = 'disabled';
    this.props.updatedAt = new Date();
  }

  completeProfile(params: { fullName: string; identification: string; avatarFileId?: string | null }): void {
    this.props.fullName = params.fullName;
    this.props.identification = params.identification;
    if (params.avatarFileId !== undefined) {
      this.props.avatarFileId = params.avatarFileId;
    }
    this.props.updatedAt = new Date();
  }

  bumpPermissionsVersion(): void {
    this.props.permissionsVersion += 1;
    this.props.updatedAt = new Date();
  }

  toPersistence(): UserProps {
    return { ...this.props };
  }
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------
export interface OrganizationProps {
  id: string;
  countryCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Organization {
  private constructor(private props: OrganizationProps) {}

  /**
   * Read-model MÍNIMO de la organización dentro de auth: solo lo que auth
   * necesita para firmar el token (id + country_code). El nombre, el RUC, los
   * establecimientos y demás datos de negocio los posee organization-service.
   * El `country_code` se actualiza al consumir `organization.org.updated`.
   */
  static create(params: { id?: string; countryCode?: string | null }): Organization {
    const now = new Date();
    return new Organization({
      id: params.id ?? randomUUID(),
      countryCode: params.countryCode ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: OrganizationProps): Organization {
    return new Organization({ ...props });
  }

  get id(): string { return this.props.id; }
  get countryCode(): string | null { return this.props.countryCode; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  toPersistence(): OrganizationProps {
    return { ...this.props };
  }
}

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------
export interface RoleProps {
  id: string;
  organizationId: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Role {
  private constructor(private props: RoleProps) {}

  static createForOrg(params: { organizationId: string; name: string; description?: string | null; isSystem?: boolean }): Role {
    const now = new Date();
    return new Role({
      id: randomUUID(),
      organizationId: params.organizationId,
      name: params.name,
      description: params.description ?? null,
      isSystem: params.isSystem ?? false,
      createdAt: now,
      updatedAt: now,
    });
  }

  static template(params: { name: string; description?: string | null }): Role {
    const now = new Date();
    return new Role({
      id: randomUUID(),
      organizationId: null,
      name: params.name,
      description: params.description ?? null,
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: RoleProps): Role {
    return new Role({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string | null { return this.props.organizationId; }
  get name(): string { return this.props.name; }
  get description(): string | null { return this.props.description; }
  get isSystem(): boolean { return this.props.isSystem; }
  get createdAt(): Date { return this.props.createdAt; }

  toPersistence(): RoleProps {
    return { ...this.props };
  }
}

// ---------------------------------------------------------------------------
// Permission (solo lectura en runtime)
// ---------------------------------------------------------------------------
export interface PermissionProps {
  id: string;
  code: string;
  resource: string;
  action: string;
  description: string | null;
}

export class Permission {
  private constructor(private props: PermissionProps) {}

  static fromPersistence(props: PermissionProps): Permission {
    return new Permission({ ...props });
  }

  get id(): string { return this.props.id; }
  get code(): string { return this.props.code; }
  get resource(): string { return this.props.resource; }
  get action(): string { return this.props.action; }
  get description(): string | null { return this.props.description; }

  toPersistence(): PermissionProps {
    return { ...this.props };
  }
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------
export interface MembershipProps {
  id: string;
  userId: string;
  organizationId: string;
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class Membership {
  private constructor(private props: MembershipProps) {}

  static create(params: { userId: string; organizationId: string; status?: MembershipStatus }): Membership {
    const now = new Date();
    return new Membership({
      id: randomUUID(),
      userId: params.userId,
      organizationId: params.organizationId,
      status: params.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: MembershipProps): Membership {
    return new Membership({ ...props });
  }

  get id(): string { return this.props.id; }
  get userId(): string { return this.props.userId; }
  get organizationId(): string { return this.props.organizationId; }
  get status(): MembershipStatus { return this.props.status; }

  isActive(): boolean {
    return this.props.status === 'active';
  }

  toPersistence(): MembershipProps {
    return { ...this.props };
  }
}

// ---------------------------------------------------------------------------
// UserRole (asignación de rol a usuario en una organización)
// ---------------------------------------------------------------------------
export interface UserRoleProps {
  id: string;
  userId: string;
  organizationId: string;
  roleId: string;
  createdAt: Date;
}

export class UserRole {
  private constructor(private props: UserRoleProps) {}

  static assign(params: { userId: string; organizationId: string; roleId: string }): UserRole {
    return new UserRole({
      id: randomUUID(),
      userId: params.userId,
      organizationId: params.organizationId,
      roleId: params.roleId,
      createdAt: new Date(),
    });
  }

  static fromPersistence(props: UserRoleProps): UserRole {
    return new UserRole({ ...props });
  }

  get id(): string { return this.props.id; }
  get userId(): string { return this.props.userId; }
  get organizationId(): string { return this.props.organizationId; }
  get roleId(): string { return this.props.roleId; }
  get createdAt(): Date { return this.props.createdAt; }

  toPersistence(): UserRoleProps {
    return { ...this.props };
  }
}
