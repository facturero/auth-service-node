import { Credential } from '../../domain/entities';
import { Email } from '../../domain/value-objects';
import { EmailAlreadyExistsError } from '../../domain/errors';
import { PasswordHasher, TokenService, UnitOfWork } from '../ports';
import { RegisterInput, SessionOutput } from '../dtos';
import { issueSession } from '../session';

/**
 * Registro con email + contraseña.
 * Crea la credencial y publica el evento (outbox) de forma atómica,
 * luego emite la sesión.
 */
export class RegisterWithPasswordUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: RegisterInput): Promise<SessionOutput> {
    const email = Email.create(input.email);
    const passwordHash = await this.hasher.hash(input.password);

    return this.uow.execute(async (repos) => {
      const existing = await repos.credentials.findByEmail(email.value);
      if (existing) {
        throw new EmailAlreadyExistsError();
      }

      const credential = Credential.createWithPassword({ email, passwordHash });
      await repos.credentials.save(credential);

      await repos.outbox.add({
        type: 'auth.credential.registered',
        aggregateType: 'credential',
        aggregateId: credential.id,
        payload: {
          credentialId: credential.id,
          userId: credential.userId,
          email: credential.email,
          provider: 'password',
        },
        occurredAt: new Date(),
      });

      return issueSession({
        credential,
        tokenService: this.tokenService,
        refreshTokens: repos.refreshTokens,
        authProvider: 'password',
        userAgent: input.userAgent,
        ip: input.ip,
      });
    });
  }
}
