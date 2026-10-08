import { Email } from '../../domain/value-objects';
import { InvalidCredentialsError, AccountDisabledError } from '../../domain/errors';
import { AccessContextResolver, PasswordHasher, TokenService } from '../ports';
import { CredentialRepository, RefreshTokenRepository } from '../../domain/repositories';
import { LoginInput, SessionOutput } from '../dtos';
import { issueSession } from '../session';
import { SessionAuditor } from '../session-audit';

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
    private readonly accessContext: AccessContextResolver,
    private readonly audit?: SessionAuditor,
  ) {}

  async execute(input: LoginInput): Promise<SessionOutput> {
    const email = Email.create(input.email);
    const credential = await this.credentials.findByEmail(email.value);

    // Si no existe o no tiene contraseña (cuenta solo-Google) -> credenciales inválidas.
    const meta = { email: email.value, ip: input.ip, userAgent: input.userAgent, provider: 'password' };
    const fail = async (reason: string, err: Error): Promise<never> => {
      // Con la organización activa de la cuenta, el intento fallido aparece en la bitácora de ESA empresa (si no, quedaría
      // como evento de plataforma, que ningún administrador ve). Un correo que no existe no tiene organización.
      let organizationId: string | null = null;
      if (credential && this.audit) {
        try {
          organizationId = (await this.accessContext.resolve(credential.userId)).orgId;
        } catch {
          // La bitácora no puede ser la razón por la que el login responda distinto: sin organización, se registra igual.
        }
      }
      await this.audit?.record('auth.session.login_failed', { ...meta, userId: credential?.userId, organizationId, reason });
      throw err;
    };

    if (!credential || !credential.hasPassword()) {
      return fail('invalid_credentials', new InvalidCredentialsError());
    }
    if (!credential.isActive()) {
      return fail('account_disabled', new AccountDisabledError());
    }

    const valid = await this.hasher.verify(input.password, credential.passwordHash as string);
    if (!valid) {
      return fail('invalid_credentials', new InvalidCredentialsError());
    }

    const contextOut = { orgId: null as string | null };
    const session = await issueSession({
      contextOut,
      credential,
      tokenService: this.tokenService,
      refreshTokens: this.refreshTokens,
      authProvider: 'password',
      accessContext: this.accessContext,
      userAgent: input.userAgent,
      ip: input.ip,
    });
    await this.audit?.record('auth.session.login_succeeded', {
      ...meta,
      userId: credential.userId,
      organizationId: contextOut.orgId,
    });
    return session;
  }
}
