import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { ResetPasswordUseCase } from '../application/use-cases/reset-password';
import { InMemoryUnitOfWork, MockAccessContextResolver, MockPasswordHasher, MockTokenService } from './helpers';
import { Credential, PasswordResetToken } from '../domain/entities';
import { Email } from '../domain/value-objects';
import { Membership, User } from '../domain/rbac';

describe('ResetPasswordUseCase', () => {
  let uow: InMemoryUnitOfWork;
  let useCase: ResetPasswordUseCase;

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    useCase = new ResetPasswordUseCase(
      uow,
      new MockPasswordHasher(),
      new MockTokenService(),
      new MockAccessContextResolver(),
      uow.refreshTokens,
    );
  });

  async function seed(orgIds: string[], opts: { disabledOrgs?: string[] } = {}) {
    const credential = Credential.createWithPassword({ email: Email.create('u@test.com'), passwordHash: 'hashed:vieja' });
    await uow.credentials.save(credential);
    const user = User.create({ id: credential.userId, email: 'u@test.com' });
    await uow.users.save(user);
    for (const organizationId of orgIds) {
      const m = Membership.create({ userId: user.id, organizationId });
      if (opts.disabledOrgs?.includes(organizationId)) m.disable();
      await uow.memberships.save(m);
    }
    const token = 'token-de-un-solo-uso';
    await uow.passwordResetTokens.save(
      PasswordResetToken.issue({
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    return { user, token };
  }

  it('el evento password_reset_completed lleva las organizaciones del usuario (para avisar a sus cajas POS)', async () => {
    const { user, token } = await seed(['org-1', 'org-2']);

    await useCase.execute({ token, password: 'nueva-clave-123' });

    const event = uow.outbox.events.find((e) => e.type === 'identity.user.password_reset_completed');
    expect(event).toBeDefined();
    expect(event!.payload).toMatchObject({ userId: user.id, email: 'u@test.com' });
    expect([...(event!.payload as { organizationIds: string[] }).organizationIds].sort()).toEqual(['org-1', 'org-2']);
  });

  it('solo cuentan las organizaciones donde el usuario sigue activo', async () => {
    const { token } = await seed(['org-1', 'org-2'], { disabledOrgs: ['org-2'] });

    await useCase.execute({ token, password: 'nueva-clave-123' });

    const event = uow.outbox.events.find((e) => e.type === 'identity.user.password_reset_completed');
    expect((event!.payload as { organizationIds: string[] }).organizationIds).toEqual(['org-1']);
  });

  it('un usuario sin membresías activas emite el evento con la lista vacía (no rompe)', async () => {
    const { token } = await seed([]);

    await useCase.execute({ token, password: 'nueva-clave-123' });

    const event = uow.outbox.events.find((e) => e.type === 'identity.user.password_reset_completed');
    expect((event!.payload as { organizationIds: string[] }).organizationIds).toEqual([]);
  });
});
