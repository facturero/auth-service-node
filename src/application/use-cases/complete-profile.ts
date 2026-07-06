import { Identification } from '../../domain/value-objects';
import { IdentificationAlreadyExistsError, UserNotFoundError } from '../../domain/errors';
import { Repositories } from '../../domain/repositories';
import { UnitOfWork } from '../ports';

export interface CompleteProfileInput {
  userId: string;
  fullName: string;
  identificationType: string;
  identificationNumber: string;
}

export interface CompleteProfileOutput {
  id: string;
  email: string;
  fullName: string | null;
  identification: { type: string; number: string } | null;
  status: string;
}

export class CompleteProfileUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: CompleteProfileInput): Promise<CompleteProfileOutput> {
    const id = Identification.create(input.identificationType, input.identificationNumber);

    return this.uow.execute(async (repos: Repositories) => {
      const user = await repos.users.findById(input.userId);
      if (!user) {
        throw new UserNotFoundError();
      }

      const existingIdent = await repos.users.findByIdentification(id.toString());
      if (existingIdent && existingIdent.id !== input.userId) {
        throw new IdentificationAlreadyExistsError();
      }

      user.completeProfile({ fullName: input.fullName, identification: id.toString() });
      await repos.users.save(user);

      await repos.outbox.add({
        type: 'identity.user.profile_completed',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: {
          userId: user.id,
          fullName: input.fullName,
          identification: id.toString(),
        },
        occurredAt: new Date(),
      });

      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        identification: {
          type: id.type,
          number: id.number,
        },
        status: user.status,
      };
    });
  }
}