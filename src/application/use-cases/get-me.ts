import { UnauthorizedError } from '../../domain/errors';
import { CredentialRepository } from '../../domain/repositories';
import { MeOutput } from '../dtos';

/**
 * Devuelve los datos del usuario autenticado a partir de su user_id
 * (extraído del access token por el middleware).
 */
export class GetMeUseCase {
  constructor(private readonly credentials: CredentialRepository) {}

  async execute(userId: string): Promise<MeOutput> {
    const credential = await this.credentials.findByUserId(userId);
    if (!credential || !credential.isActive()) {
      throw new UnauthorizedError();
    }

    return {
      id: credential.userId,
      email: credential.email,
      emailVerified: credential.emailVerified,
      authProvider: credential.hasPassword() ? 'password' : 'google',
      createdAt: credential.createdAt.toISOString(),
    };
  }
}
