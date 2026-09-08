import { Repositories } from '../../domain/repositories';
import { UnitOfWork } from '../ports';
import { NotOrganizationMemberError } from '../../domain/errors';

export interface UpdateUserEstablishmentsInput {
  organizationId: string;
  userId: string;
  establishmentIds: string[];
}

export class UpdateUserEstablishmentsUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: UpdateUserEstablishmentsInput): Promise<void> {
    await this.uow.execute(async (repos: Repositories) => {
      const membership = await repos.memberships.find(input.userId, input.organizationId);
      if (!membership) throw new NotOrganizationMemberError();

      await repos.userEstablishments.replaceForUser(input.userId, input.establishmentIds);
      await repos.users.incrementPermissionsVersion(input.userId);

      // Doble motivo, no solo la bitácora: al subir el pv sin publicar nada, el
      // gateway no invalidaba su caché y el token seguía dando acceso a los
      // establecimientos viejos hasta que venciera el TTL (mismo mecanismo que
      // `identity.role.updated`, ver BUG #9). `userIds` es lo que el gateway lee.
      await repos.outbox.add({
        type: 'identity.user.establishments_updated',
        aggregateType: 'user',
        aggregateId: input.userId,
        payload: {
          userId: input.userId,
          userIds: [input.userId],
          organizationId: input.organizationId,
          establishmentIds: input.establishmentIds,
        },
        occurredAt: new Date(),
      });
    });
  }
}
