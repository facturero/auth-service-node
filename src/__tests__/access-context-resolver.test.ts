import { describe, it, expect, beforeEach } from 'vitest';
import { SequelizeAccessContextResolver } from '../infrastructure/security/access-context-resolver';
import { AccessQuery, MembershipRepository, UserRepository } from '../domain/repositories';
import { User, Membership } from '../domain/rbac';

class FakeUserRepo implements UserRepository {
  private store = new Map<string, User>();
  async findById(id: string) { return this.store.get(id) ?? null; }
  async findByEmail(_email: string): Promise<User | null> { return null; }
  async findByIdentification(_identification: string): Promise<User | null> { return null; }
  async save(u: User) { this.store.set(u.id, u); }
  async incrementPermissionsVersion(userId: string) {
    const u = this.store.get(userId);
    if (u) u.bumpPermissionsVersion();
  }
  async listByOrganization(_orgId: string): Promise<User[]> { return []; }
}

class FakeMembershipRepo implements MembershipRepository {
  private store = new Map<string, Membership>();
  private key(u: string, o: string) { return `${u}:${o}`; }
  async find(userId: string, organizationId: string) {
    return this.store.get(this.key(userId, organizationId)) ?? null;
  }
  async listActiveByUser(userId: string) {
    return Array.from(this.store.values())
      .filter((m) => m.userId === userId && m.isActive());
  }
  async save(m: Membership) { this.store.set(this.key(m.userId, m.organizationId), m); }
}

class FakeAccessQuery implements AccessQuery {
  private perms = new Map<string, string[]>();
  private codes = new Map<string, string | null>();

  setPermissions(userId: string, orgId: string, perms: string[]) {
    this.perms.set(`${userId}:${orgId}`, perms);
  }
  setCountryCode(orgId: string, code: string | null) {
    this.codes.set(orgId, code);
  }

  async effectivePermissions(userId: string, organizationId: string): Promise<string[]> {
    return this.perms.get(`${userId}:${organizationId}`) ?? [];
  }
  async countryCodeOf(organizationId: string): Promise<string | null> {
    return this.codes.get(organizationId) ?? null;
  }
}

describe('SequelizeAccessContextResolver', () => {
  let users: FakeUserRepo;
  let memberships: FakeMembershipRepo;
  let query: FakeAccessQuery;
  let resolver: SequelizeAccessContextResolver;

  beforeEach(() => {
    users = new FakeUserRepo();
    memberships = new FakeMembershipRepo();
    query = new FakeAccessQuery();
    resolver = new SequelizeAccessContextResolver(users, memberships, query);
  });

  it('returns null orgId when user has no memberships', async () => {
    const ctx = await resolver.resolve('user-without-org');
    expect(ctx.orgId).toBeNull();
    expect(ctx.countryCode).toBeNull();
    expect(ctx.permissions).toEqual([]);
    expect(ctx.pv).toBe(0);
  });

  it('selects the first active membership when no preferredOrgId', async () => {
    const user = User.fromPersistence({
      id: 'u1', email: 'u@t.com', identification: null, fullName: null, status: 'active',
      isPlatformAdmin: false, permissionsVersion: 3,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await users.save(user);

    await memberships.save(Membership.create({ userId: 'u1', organizationId: 'org-a', status: 'active' }));
    await memberships.save(Membership.create({ userId: 'u1', organizationId: 'org-b', status: 'active' }));

    query.setPermissions('u1', 'org-a', ['user:read']);
    query.setCountryCode('org-a', 'EC');

    const ctx = await resolver.resolve('u1');
    expect(ctx.orgId).toBe('org-a');
    expect(ctx.countryCode).toBe('EC');
    expect(ctx.permissions).toEqual(['user:read']);
    expect(ctx.pv).toBe(3);
  });

  it('uses preferredOrgId when user is active member', async () => {
    const user = User.fromPersistence({
      id: 'u2', email: 'u2@t.com', identification: null, fullName: null, status: 'active',
      isPlatformAdmin: false, permissionsVersion: 0,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await users.save(user);

    await memberships.save(Membership.create({ userId: 'u2', organizationId: 'org-x', status: 'active' }));
    query.setPermissions('u2', 'org-x', ['org:admin']);
    query.setCountryCode('org-x', 'MX');

    const ctx = await resolver.resolve('u2', 'org-x');
    expect(ctx.orgId).toBe('org-x');
    expect(ctx.countryCode).toBe('MX');
    expect(ctx.permissions).toEqual(['org:admin']);
  });

  it('ignores preferredOrgId when membership is inactive', async () => {
    const user = User.fromPersistence({
      id: 'u3', email: 'u3@t.com', identification: null, fullName: null, status: 'active',
      isPlatformAdmin: false, permissionsVersion: 0,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await users.save(user);
    await memberships.save(Membership.create({ userId: 'u3', organizationId: 'org-main', status: 'active' }));
    await memberships.save(Membership.create({ userId: 'u3', organizationId: 'org-pref', status: 'disabled' }));

    query.setPermissions('u3', 'org-main', ['user:read']);
    query.setCountryCode('org-main', 'EC');
    query.setCountryCode('org-pref', 'US');

    const ctx = await resolver.resolve('u3', 'org-pref');
    // Falls back to first active
    expect(ctx.orgId).toBe('org-main');
    expect(ctx.countryCode).toBe('EC');
    expect(ctx.permissions).toEqual(['user:read']);
  });

  it('returns pv even without org', async () => {
    const user = User.fromPersistence({
      id: 'u-pv', email: 'u@t.com', identification: null, fullName: null, status: 'active',
      isPlatformAdmin: false, permissionsVersion: 7,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await users.save(user);

    const ctx = await resolver.resolve('u-pv');
    expect(ctx.orgId).toBeNull();
    expect(ctx.pv).toBe(7);
  });
});
