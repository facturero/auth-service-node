import { Credential, OAuthAccount } from '../../domain/entities';
import { Organization, User } from '../../domain/rbac';
import { Email } from '../../domain/value-objects';
import { AccountDisabledError, IdentificationAlreadyExistsError } from '../../domain/errors';
import { Repositories } from '../../domain/repositories';
import { AccessContextResolver, GoogleIdTokenVerifier, TokenService, UnitOfWork } from '../ports';
import { SeedOrganizationRolesUseCase } from './seed-organization-roles';
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
    private readonly accessContext: AccessContextResolver,
    private readonly seedOrgRoles: SeedOrganizationRolesUseCase,
  ) {}

  async execute(input: GoogleAuthInput): Promise<SessionOutput> {
    const profile = await this.googleVerifier.verify(input.idToken);
    const email = Email.create(profile.email);

    return this.uow.execute(async (repos) => {
      const linked = await repos.oauthAccounts.findByProvider('google', profile.sub);
      if (linked) {
        const credential = await repos.credentials.findById(linked.credentialId);
        if (!credential) {
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
          accessContext: this.accessContext,
          userAgent: input.userAgent,
          ip: input.ip,
        });
      }

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
          accessContext: this.accessContext,
          userAgent: input.userAgent,
          ip: input.ip,
        });
      }

      return this.createLinkedAccount(repos, email, profile.sub, profile.emailVerified, input);
    });
  }

  private async createLinkedAccount(
    repos: Repositories,
    email: Email,
    providerUserId: string,
    emailVerified: boolean,
    input: GoogleAuthInput,
  ): Promise<SessionOutput> {
    const credential = Credential.createWithGoogle({ email, emailVerified });

    const hasIdentification = !!input.identification;
    if (hasIdentification) {
      const existingIdent = await repos.users.findByIdentification(input.identification!);
      if (existingIdent) {
        throw new IdentificationAlreadyExistsError();
      }
    }

    const user = User.create({
      id: credential.userId,
      email: credential.email,
      identification: input.identification ?? null,
    });
    await repos.users.save(user);
    await repos.credentials.save(credential);

    const account = OAuthAccount.create({
      credentialId: credential.id,
      provider: 'google',
      providerUserId,
      email: email.value,
    });
    await repos.oauthAccounts.save(account);

    let organizationId: string | undefined;
    if (hasIdentification) {
      const org = Organization.create({});
      await repos.organizations.save(org);
      organizationId = org.id;

      await this.seedOrgRoles.seed(
        { organizationId: org.id, countryCode: null, name: null, founderUserId: user.id },
        repos,
      );
    }

    await repos.outbox.add({
      type: 'identity.user.created',
      aggregateType: 'user',
      aggregateId: user.id,
      payload: {
        userId: user.id,
        email: user.email,
        identification: input.identification ?? null,
        organizationId: organizationId ?? null,
      },
      occurredAt: new Date(),
    });

    return issueSession({
      credential,
      tokenService: this.tokenService,
      refreshTokens: repos.refreshTokens,
      authProvider: 'google',
      isNewUser: true,
      needsOrg: !hasIdentification,
      organizationId,
      accessContext: this.accessContext,
      preferredOrgId: organizationId ?? null,
      userAgent: input.userAgent,
      ip: input.ip,
    });
  }
}
