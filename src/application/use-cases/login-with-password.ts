import { Email } from '../../domain/value-objects';
import { InvalidCredentialsError, AccountDisabledError } from '../../domain/errors';
import { PasswordHasher, TokenService } from '../ports';
import { CredentialRepository, RefreshTokenRepository } from '../../domain/repositories';
import { LoginInput, SessionOutput } from '../dtos';
import { issueSession } from '../session';

/**
 * Login con email + contraseña.
 * Mensaje de error genérico para no revelar si el email existe.
 */
export class LoginWithPasswordUseCase {
  constructor(
    private readonly credentials: CredentialRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: LoginInput): Promise<SessionOutput> {
    const email = Email.create(input.email);
    const credential = await this.credentials.findByEmail(email.value);

    // Si no existe o no tiene contraseña (cuenta solo-Google) -> credenciales inválidas.
    if (!credential || !credential.hasPassword()) {
      throw new InvalidCredentialsError();
    }
    if (!credential.isActive()) {
      throw new AccountDisabledError();
    }

    const valid = await this.hasher.verify(input.password, credential.passwordHash as string);
    if (!valid) {
      throw new InvalidCredentialsError();
    }

    return issueSession({
      credential,
      tokenService: this.tokenService,
      refreshTokens: this.refreshTokens,
      authProvider: 'password',
      userAgent: input.userAgent,
      ip: input.ip,
    });
  }
}
