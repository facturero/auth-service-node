import { describe, it, expect } from 'vitest';
import { User, Role, Permission, Membership, UserRole } from '../domain/rbac';

describe('User', () => {
  it('creates a user with default values', () => {
    const u = User.create({ id: 'u1', email: 'test@test.com' });
    expect(u.id).toBe('u1');
    expect(u.email).toBe('test@test.com');
    expect(u.identification).toBeNull();
    expect(u.isPlatformAdmin).toBe(false);
    expect(u.permissionsVersion).toBe(0);
  });

  it('creates a user with identification', () => {
    const u = User.create({ id: 'u2', email: 't@t.com', identification: '12345678' });
    expect(u.identification).toBe('12345678');
  });

  it('fromPersistence restores custom values', () => {
    const u = User.fromPersistence({
        id: 'u1',
        email: 'test@test.com',
        identification: null,
        fullName: null,
        avatarFileId: null,
        status: 'active',
        isPlatformAdmin: true,
        permissionsVersion: 5,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-06-01'),
      });
    expect(u.isPlatformAdmin).toBe(true);
    expect(u.permissionsVersion).toBe(5);
  });

  it('bumpPermissionsVersion increments by 1', () => {
    const u = User.create({ id: 'u1', email: 'test@test.com' });
    expect(u.permissionsVersion).toBe(0);
    u.bumpPermissionsVersion();
    expect(u.permissionsVersion).toBe(1);
    u.bumpPermissionsVersion();
    expect(u.permissionsVersion).toBe(2);
  });

  it('round-trips via toPersistence / fromPersistence', () => {
    const now = new Date();
    const u = User.fromPersistence({
        id: 'u1',
        email: 'test@test.com',
        identification: 'cedula:123',
        fullName: 'Test User',
        avatarFileId: null,
        status: 'active',
        isPlatformAdmin: true,
        permissionsVersion: 0,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-06-01'),
      });
    expect(u.toPersistence()).toEqual({
      id: 'u1',
      email: 'test@test.com',
      identification: 'cedula:123',
      fullName: 'Test User',
      avatarFileId: null,
      status: 'active',
      isPlatformAdmin: true,
      permissionsVersion: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-06-01'),
    });
  });
});

describe('Role', () => {
  it('creates a template role (no organizationId)', () => {
    const r = Role.template({ name: 'Admin', description: 'desc' });
    expect(r.name).toBe('Admin');
    expect(r.description).toBe('desc');
    expect(r.organizationId).toBeNull();
    expect(r.isSystem).toBe(true);
    expect(r.id).toBeDefined();
  });

  it('createForOrg creates organization-bound role', () => {
    const r = Role.createForOrg({
      organizationId: 'org-1',
      name: 'Editor',
      description: 'Editor desc',
      isSystem: false,
    });
    expect(r.name).toBe('Editor');
    expect(r.organizationId).toBe('org-1');
    expect(r.isSystem).toBe(false);
  });

  it('round-trips via toPersistence / fromPersistence', () => {
    const now = new Date();
    const r = Role.fromPersistence({
      id: 'role-1',
      organizationId: null,
      name: 'Admin',
      description: 'desc',
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
    expect(r.toPersistence()).toEqual({
      id: 'role-1',
      organizationId: null,
      name: 'Admin',
      description: 'desc',
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  });
});

describe('Permission', () => {
  it('fromPersistence restores permission data', () => {
    const p = Permission.fromPersistence({
      id: 'perm-1',
      code: 'user:read',
      resource: 'user',
      action: 'read',
      description: 'Read users',
    });
    expect(p.code).toBe('user:read');
    expect(p.description).toBe('Read users');
    expect(p.resource).toBe('user');
    expect(p.action).toBe('read');
  });

  it('round-trips via toPersistence / fromPersistence', () => {
    const p = Permission.fromPersistence({
      id: 'perm-1',
      code: 'org:admin',
      resource: 'org',
      action: 'admin',
      description: 'Admin org',
    });
    expect(p.toPersistence()).toEqual({
      id: 'perm-1',
      code: 'org:admin',
      resource: 'org',
      action: 'admin',
      description: 'Admin org',
    });
  });
});

describe('Membership', () => {
  it('creates an active membership', () => {
    const m = Membership.create({ userId: 'u1', organizationId: 'org-1', status: 'active' });
    expect(m.userId).toBe('u1');
    expect(m.organizationId).toBe('org-1');
    expect(m.isActive()).toBe(true);
    expect(m.id).toBeDefined();
  });

  it('isActive returns false for non-active statuses', () => {
    const m = Membership.create({ userId: 'u1', organizationId: 'org-1', status: 'disabled' });
    expect(m.isActive()).toBe(false);
  });

  it('round-trips via toPersistence / fromPersistence', () => {
    const now = new Date();
    const m = Membership.fromPersistence({
      id: 'm-1',
      userId: 'u1',
      organizationId: 'org-1',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    expect(m.toPersistence()).toEqual({
      id: 'm-1',
      userId: 'u1',
      organizationId: 'org-1',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  });
});

describe('UserRole', () => {
  it('assigns a role to a user', () => {
    const ur = UserRole.assign({ userId: 'u1', organizationId: 'org-1', roleId: 'role-1' });
    expect(ur.userId).toBe('u1');
    expect(ur.organizationId).toBe('org-1');
    expect(ur.roleId).toBe('role-1');
    expect(ur.id).toBeDefined();
    expect(ur.createdAt).toBeInstanceOf(Date);
  });

  it('round-trips via toPersistence / fromPersistence', () => {
    const now = new Date();
    const ur = UserRole.fromPersistence({
      id: 'ur-1',
      userId: 'u1',
      organizationId: 'org-1',
      roleId: 'role-1',
      createdAt: now,
    });
    expect(ur.toPersistence()).toEqual({
      id: 'ur-1',
      userId: 'u1',
      organizationId: 'org-1',
      roleId: 'role-1',
      createdAt: now,
    });
  });
});
