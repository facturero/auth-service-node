import { describe, it, expect, beforeEach } from 'vitest';
import { SwitchOrganizationUseCase } from '../application/use-cases/switch-organization';
import { Credential } from '../domain/entities';
import { Email } from '../domain/value-objects';
import { Membership } from '../domain/rbac';
import {
  InMemoryUnitOfWork,
  MockTokenService,
  MockAccessContextResolver,
} from './helpers';
import { NotOrganizationMemberError } from '../domain/errors';

describe('SwitchOrganizationUseCase', () => {
  let uow: InMemoryUnitOfWork;
  let tokenService: MockTokenService;
  let accessContextResolver: MockAccessContextResolver;
  let useCase: SwitchOrganizationUseCase;

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    tokenService = new MockTokenService();
    accessContextResolver = new MockAccessContextResolver();
    useCase = new SwitchOrganizationUseCase(uow, tokenService, accessContextResolver);
  });

  it('issues a new session when user is a member', async () => {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({ email, passwordHash: 'hash' });
    await uow.credentials.save(credential);

    const membership = Membership.create({
      userId: credential.userId,
      organizationId: 'org-1',
      status: 'active',
    });
    await uow.memberships.save(membership);

    const result = await useCase.execute({
      userId: credential.userId,
      organizationId: 'org-1',
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.id).toBe(credential.userId);
  });

  it('throws NotOrganizationMemberError when user is not a member', async () => {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({ email, passwordHash: 'hash' });
    await uow.credentials.save(credential);

    await expect(
      useCase.execute({ userId: credential.userId, organizationId: 'org-unknown' }),
    ).rejects.toThrow(NotOrganizationMemberError);
  });

  it('throws NotOrganizationMemberError when membership is inactive', async () => {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({ email, passwordHash: 'hash' });
    await uow.credentials.save(credential);

    const membership = Membership.create({
      userId: credential.userId,
      organizationId: 'org-1',
      status: 'disabled',
    });
    await uow.memberships.save(membership);

    await expect(
      useCase.execute({ userId: credential.userId, organizationId: 'org-1' }),
    ).rejects.toThrow(NotOrganizationMemberError);
  });

  it('throws NotOrganizationMemberError when credential is inactive', async () => {
    const credential = Credential.fromPersistence({
      id: 'cred-1',
      userId: 'u1',
      email: 'user@test.com',
      passwordHash: 'hash',
      emailVerified: false,
      status: 'disabled',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await uow.credentials.save(credential);

    const membership = Membership.create({
      userId: 'u1',
      organizationId: 'org-1',
      status: 'active',
    });
    await uow.memberships.save(membership);

    await expect(
      useCase.execute({ userId: 'u1', organizationId: 'org-1' }),
    ).rejects.toThrow(NotOrganizationMemberError);
  });

  it('passes preferredOrgId to access context resolver', async () => {
    const email = Email.create('user@test.com');
    const credential = Credential.createWithPassword({ email, passwordHash: 'hash' });
    await uow.credentials.save(credential);

    let capturedPreferredOrgId: string | null | undefined;
    const trackingResolver = new MockAccessContextResolver();
    trackingResolver.resolve = async (_userId, preferredOrgId) => {
      capturedPreferredOrgId = preferredOrgId;
      return { orgId: preferredOrgId ?? null, countryCode: null, permissions: [], pv: 0 };
    };
    const uc = new SwitchOrganizationUseCase(uow, tokenService, trackingResolver);

    const membership = Membership.create({
      userId: credential.userId,
      organizationId: 'org-switch',
      status: 'active',
    });
    await uow.memberships.save(membership);

    await uc.execute({ userId: credential.userId, organizationId: 'org-switch' });
    expect(capturedPreferredOrgId).toBe('org-switch');
  });
});
