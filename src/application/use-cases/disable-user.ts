import { Repositories } from '../../domain/repositories';
import { UnitOfWork } from '../ports';
import { UserNotFoundError, NotOrganizationMemberError, ForbiddenError, LastAdminRemovalError } from '../../domain/errors';

export interface DisableUserInput {
  organizationId: string;
  userId: string;
  actorId: string;
}

export class DisableUserUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: DisableUserInput): Promise<void> {
    if (input.userId === input.actorId) {
      throw new ForbiddenError('No puedes desactivarte a ti mismo.');
    }

    await this.uow.execute(async (repos: Repositories) => {
      const user = await repos.users.findById(input.userId);
      if (!user) throw new UserNotFoundError();

      const org = await repos.organizations.findById(input.organizationId);
      if (org?.ownerId === input.userId) {
        throw new ForbiddenError('No puedes desactivar al dueño de la organización.');
      }

      const membership = await repos.memberships.find(input.userId, input.organizationId);
      if (!membership) throw new NotOrganizationMemberError();

      const isActive = user.isActive();

      if (isActive) {
        // Guard anti-lockout: no se puede desactivar a un ADMIN no-owner si es el
        // último que queda. El owner ya está protegido arriba (org.ownerId) y
        // no cuenta como admin de respaldo. Si el target NO es admin, la org
        // no pierde ningún administrador y el disable sigue adelante
        // (TEST-PLAN.md #6).
        const adminRoles = await repos.roles.findByOrganization(input.organizationId);
        const adminRoleIds = adminRoles.filter((r) => r.name === 'Administrador').map((r) => r.id);
        let targetIsAdmin = false;
        let otherActiveAdmins = 0;
        for (const roleId of adminRoleIds) {
          const userIds = await repos.userRoles.listUserIdsByRole(roleId);
          for (const uid of userIds) {
            if (uid === input.userId) {
              targetIsAdmin = true;
              continue;
            }
            if (uid === org?.ownerId) continue;
            const adminMembership = await repos.memberships.find(uid, input.organizationId);
            if (adminMembership?.isActive()) otherActiveAdmins += 1;
          }
        }
        if (targetIsAdmin && otherActiveAdmins === 0) throw new LastAdminRemovalError();

        user.disable();
        membership.disable();
      } else {
        user.activate();
        membership.activate();
      }

      await repos.users.save(user);
      await repos.memberships.save(membership);

      const orgName = org?.name ?? 'su organización';

      await repos.outbox.add({
        type: isActive ? 'identity.user.disabled' : 'identity.user.enabled',
        aggregateType: 'user',
        aggregateId: input.userId,
        payload: {
          userId: input.userId,
          email: user.email,
          organizationId: input.organizationId,
          organizationName: orgName,
        },
        occurredAt: new Date(),
      });

      await repos.users.incrementPermissionsVersion(input.userId);
    });
  }
}
