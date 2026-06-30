import { Credential, OAuthAccount } from '../../domain/entities';
import { Email } from '../../domain/value-objects';
import { AccountDisabledError } from '../../domain/errors';
import { GoogleIdTokenVerifier, TokenService, UnitOfWork } from '../ports';
import { GoogleAuthInput, SessionOutput } from '../dtos';
import { issueSession } from '../session';

/**
 * Inicia sesión o crea cuenta con Google (flujo ID Token).
 * Reglas:
 *  1. Si el (provider, sub) ya está vinculado -> login.
 *  2. Si el email ya existe como cuenta local verificada -> vincular.
 *  3. Si no existe -> crear cuenta (sin contraseña).
 */
export class LoginWithGoogleUseCase {
  constructor(
    private readonly googleVerifier: GoogleIdTokenVerifier,
    private readonly uow: UnitOfWork,
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: GoogleAuthInput): Promise<SessionOutput> {
    // La verificación (firma, aud, exp) ocurre fuera de la transacción.
    const profile = await this.googleVerifier.verify(input.idToken);
    const email = Email.create(profile.email);

    return this.uow.execute(async (repos) => {
      // (1) ¿Ya está vinculada esta cuenta de Google?
      const linked = await repos.oauthAccounts.findByProvider('google', profile.sub);
      if (linked) {
        const credential = await repos.credentials.findById(linked.credentialId);
        if (!credential) {
          // Inconsistencia: vínculo sin credencial. Tratar como no vinculado.
          return this.createLinkedAccount(repos, email, profile.sub, profile.emailVerified, input);
        }
        if (!credential.isActive()) {
          throw new AccountDisabledError();
        }
        return issueSession({
          credential,
          tokenService: this.tokenService,
          refreshTokens: repos.refreshTokens,
          authProvider: 'google',
          isNewUser: false,
          userAgent: input.userAgent,
          ip: input.ip,
        });
      }

      // (2) ¿Existe ya una cuenta local con ese email (verificado)?
      const existing = await repos.credentials.findByEmail(email.value);
      if (existing && profile.emailVerified) {
        if (!existing.isActive()) {
          throw new AccountDisabledError();
        }
        const account = OAuthAccount.create({
          credentialId: existing.id,
          provider: 'google',
          providerUserId: profile.sub,
          email: profile.email,
        });
        await repos.oauthAccounts.save(account);

        if (!existing.emailVerified) {
          existing.markEmailVerified();
          await repos.credentials.save(existing);
        }

        await repos.outbox.add({
          type: 'auth.credential.linked_google',
          aggregateType: 'credential',
          aggregateId: existing.id,
          payload: {
            credentialId: existing.id,
            userId: existing.userId,
            email: existing.email,
            providerUserId: profile.sub,
          },
          occurredAt: new Date(),
        });

        return issueSession({
          credential: existing,
          tokenService: this.tokenService,
          refreshTokens: repos.refreshTokens,
          authProvider: 'google',
          isNewUser: false,
          userAgent: input.userAgent,
          ip: input.ip,
        });
      }

      // (3) No existe -> crear cuenta nueva.
      return this.createLinkedAccount(repos, email, profile.sub, profile.emailVerified, input);
    });
  }

  /** Crea credencial (sin contraseña) + vínculo OAuth + evento, y emite sesión. */
  private async createLinkedAccount(
    repos: Parameters<Parameters<UnitOfWork['execute']>[0]>[0],
    email: Email,
    providerUserId: string,
    emailVerified: boolean,
    input: GoogleAuthInput,
  ): Promise<SessionOutput> {
    const credential = Credential.createWithGoogle({ email, emailVerified });
    await repos.credentials.save(credential);

    const account = OAuthAccount.create({
      credentialId: credential.id,
      provider: 'google',
      providerUserId,
      email: email.value,
    });
    await repos.oauthAccounts.save(account);

    await repos.outbox.add({
      type: 'auth.credential.registered',
      aggregateType: 'credential',
      aggregateId: credential.id,
      payload: {
        credentialId: credential.id,
        userId: credential.userId,
        email: credential.email,
        provider: 'google',
      },
      occurredAt: new Date(),
    });

    return issueSession({
      credential,
      tokenService: this.tokenService,
      refreshTokens: repos.refreshTokens,
      authProvider: 'google',
      isNewUser: true,
      userAgent: input.userAgent,
      ip: input.ip,
    });
  }
}
