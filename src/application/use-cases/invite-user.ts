import { Repositories } from '../../domain/repositories';
import { User, Membership, UserRole } from '../../domain/rbac';
import { UnitOfWork } from '../ports';
import { RoleNotFoundError } from '../../domain/errors';

export interface InviteUserInput {
  organizationId: string;
  email: string;
  roleId: string;
}

export class InviteUserUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: InviteUserInput): Promise<{ userId: string }> {
    return this.uow.execute(async (repos: Repositories) => {
      let user = await repos.users.findByEmail(input.email);
      if (!user) {
        user = User.create({ email: input.email });
        await repos.users.save(user);

        await repos.outbox.add({
          type: 'identity.user.created',
          aggregateType: 'user',
          aggregateId: user.id,
          payload: { userId: user.id, email: user.email },
          occurredAt: new Date(),
        });
      }

      const role = await repos.roles.findById(input.roleId);
      if (!role) throw new RoleNotFoundError();

      let membership = await repos.memberships.find(user.id, input.organizationId);
      if (!membership) {
        membership = Membership.create({
          userId: user.id,
          organizationId: input.organizationId,
          status: 'invited',
        });
        await repos.memberships.save(membership);
      }

      const ur = UserRole.assign({
        userId: user.id,
        organizationId: input.organizationId,
        roleId: input.roleId,
      });
      await repos.userRoles.assign(ur);

      await repos.users.incrementPermissionsVersion(user.id);

      await repos.outbox.add({
        type: 'identity.user.role_assigned',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: { userId: user.id, organizationId: input.organizationId, roleId: input.roleId },
        occurredAt: new Date(),
      });

      return { userId: user.id };
    });
  }
}
