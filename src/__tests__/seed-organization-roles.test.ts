import { describe, it, expect, beforeEach } from 'vitest';
import { SeedOrganizationRolesUseCase } from '../application/use-cases/seed-organization-roles';
import { Role, Permission, User } from '../domain/rbac';
import { InMemoryUnitOfWork } from './helpers';

describe('SeedOrganizationRolesUseCase', () => {
  let uow: InMemoryUnitOfWork;
  let useCase: SeedOrganizationRolesUseCase;

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    useCase = new SeedOrganizationRolesUseCase(uow);

    // Seed template roles
    const adminRole = Role.template({ name: 'Administrador', description: 'Full access' });
    const editorRole = Role.template({ name: 'Editor', description: 'Edit content' });
    const viewerRole = Role.template({ name: 'Visualizador', description: 'Read only' });
    uow.roles.save(adminRole);
    uow.roles.save(editorRole);
    uow.roles.save(viewerRole);

    // Seed some permissions (only for reference, not used by the use case)
    uow.permissions.add(Permission.fromPersistence({
      id: 'p1', code: 'org:admin', resource: 'org', action: 'admin', description: 'Admin',
    }));
    uow.permissions.add(Permission.fromPersistence({
      id: 'p2', code: 'user:read', resource: 'user', action: 'read', description: 'Read',
    }));
  });

  it('clones template roles for the organization', async () => {
    const orgId = 'org-seed-1';
    await useCase.execute({ organizationId: orgId, countryCode: null, name: null, founderUserId: 'founder-1' });

    const orgRoles = await uow.roles.findByOrganization(orgId);
    expect(orgRoles.length).toBe(3);
    expect(orgRoles.map((r) => r.name).sort()).toEqual(['Administrador', 'Editor', 'Visualizador']);
    expect(orgRoles.every((r) => r.organizationId === orgId)).toBe(true);
  });

  it('creates an active membership for the founder', async () => {
    await useCase.execute({
      organizationId: 'org-2',
      countryCode: 'EC',
      name: 'Mi Org',
      founderUserId: 'founder-2',
    });

    const membership = await uow.memberships.find('founder-2', 'org-2');
    expect(membership).not.toBeNull();
    expect(membership!.isActive()).toBe(true);
  });

  it('assigns the Administrador role to the founder', async () => {
    await useCase.execute({
      organizationId: 'org-3',
      countryCode: null,
      name: null,
      founderUserId: 'founder-3',
    });

    const userRoles = await uow.userRoles.listByUserAndOrg('founder-3', 'org-3');
    const adminRole = (await uow.roles.findByOrganization('org-3')).find((r) => r.name === 'Administrador');
    expect(adminRole).toBeDefined();
    expect(userRoles.some((ur) => ur.roleId === adminRole!.id)).toBe(true);
  });

  it('increments permissions version of the founder', async () => {
    const user = User.create({ id: 'founder-4', email: 'f@test.com' });
    await uow.users.save(user);
    expect(user.permissionsVersion).toBe(0);

    await useCase.execute({
      organizationId: 'org-4',
      countryCode: null,
      name: null,
      founderUserId: 'founder-4',
    });

    expect(user.permissionsVersion).toBe(1);
  });

  it('succeeds when there are no template roles', async () => {
    uow.roles.clear();

    await useCase.execute({
      organizationId: 'org-empty',
      countryCode: null,
      name: null,
      founderUserId: 'founder-5',
    });

    const orgRoles = await uow.roles.findByOrganization('org-empty');
    expect(orgRoles.length).toBe(0);
  });
});
