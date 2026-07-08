import { Repositories } from '../../domain/repositories';
import { User, Membership, UserRole } from '../../domain/rbac';
import { UnitOfWork, InviteTokenService } from '../ports';
import { RoleNotFoundError, UserAlreadyInvitedError } from '../../domain/errors';

export interface InviteUserInput {
  organizationId: string;
  email: string;
  roleIds: string[];
}

export class InviteUserUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly inviteTokenService: InviteTokenService,
  ) {}

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

      const existingMembership = await repos.memberships.find(user.id, input.organizationId);
      if (existingMembership) throw new UserAlreadyInvitedError();

      const membership = Membership.create({
        userId: user.id,
        organizationId: input.organizationId,
        status: 'invited',
      });
      await repos.memberships.save(membership);

      const existingRoles = await repos.userRoles.listByUserAndOrg(user.id, input.organizationId);
      const existingRoleIds = new Set(existingRoles.map((ur) => ur.roleId));

      for (const roleId of input.roleIds) {
        if (existingRoleIds.has(roleId)) continue;

        const role = await repos.roles.findById(roleId);
        if (!role) throw new RoleNotFoundError();

        const ur = UserRole.assign({
          userId: user.id,
          organizationId: input.organizationId,
          roleId,
        });
        await repos.userRoles.assign(ur);

        await repos.outbox.add({
          type: 'identity.user.role_assigned',
          aggregateType: 'user',
          aggregateId: user.id,
          payload: { userId: user.id, organizationId: input.organizationId, roleId },
          occurredAt: new Date(),
        });
      }

      await repos.users.incrementPermissionsVersion(user.id);

      const org = await repos.organizations.findById(input.organizationId);
      const organizationName = org?.name ?? 'su organización';
      const inviteUrl = this.inviteTokenService.generateInviteToken({
        userId: user.id,
        email: user.email,
        organizationId: input.organizationId,
      });

      await repos.outbox.add({
        type: 'identity.user.invited',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: {
          userId: user.id,
          email: user.email,
          organizationId: input.organizationId,
          organizationName,
          inviteUrl,
        },
        occurredAt: new Date(),
      });

      return { userId: user.id };
    });
  }
}
