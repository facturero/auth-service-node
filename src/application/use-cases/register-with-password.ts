import { Credential } from '../../domain/entities';
import { Organization, User } from '../../domain/rbac';
import { RefreshTokenRepository } from '../../domain/repositories';
import { Email } from '../../domain/value-objects';
import { EmailAlreadyExistsError, IdentificationAlreadyExistsError } from '../../domain/errors';
import { AccessContextResolver, PasswordHasher, TokenService, UnitOfWork } from '../ports';
import { SeedOrganizationRolesUseCase } from './seed-organization-roles';
import { RegisterInput, SessionOutput } from '../dtos';
import { issueSession } from '../session';

/**
 * Registro con email + contraseña.
 * Crea credencial + user (con identificación) y, de forma atómica, crea el
 * read-model MÍNIMO de la organización (solo el id), asigna el rol admin al
 * fundador y emite sesión. El perfil fiscal de la organización (razón social,
 * RUC, país, establecimientos) lo gestiona organization-service.
 */
export class RegisterWithPasswordUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly tokenService: TokenService,
    private readonly accessContext: AccessContextResolver,
    private readonly seedOrgRoles: SeedOrganizationRolesUseCase,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(input: RegisterInput): Promise<SessionOutput> {
    const email = Email.create(input.email);
    const passwordHash = await this.hasher.hash(input.password);

    const { credential, orgId } = await this.uow.execute(async (repos) => {
      const existing = await repos.credentials.findByEmail(email.value);
      if (existing) {
        throw new EmailAlreadyExistsError();
      }

      const existingIdent = await repos.users.findByIdentification(input.identification);
      if (existingIdent) {
        throw new IdentificationAlreadyExistsError();
      }

      const credential = Credential.createWithPassword({ email, passwordHash });

      const user = User.create({
        id: credential.userId,
        email: credential.email,
        identification: input.identification,
      });
      await repos.users.save(user);
      await repos.credentials.save(credential);

      const org = Organization.create({});
      await repos.organizations.save(org);

      await this.seedOrgRoles.seed(
        { organizationId: org.id, countryCode: null, name: null, founderUserId: user.id },
        repos,
      );

      await repos.outbox.add({
        type: 'identity.user.created',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: {
          userId: user.id,
          email: user.email,
          identification: input.identification,
          organizationId: org.id,
        },
        occurredAt: new Date(),
      });

      return { credential, orgId: org.id };
    });

    // issueSession OUTSIDE la transacción para que accessContext.resolve()
    // vea los role_permissions recién commiteados.
    return issueSession({
      credential,
      tokenService: this.tokenService,
      refreshTokens: this.refreshTokens,
      authProvider: 'password',
      accessContext: this.accessContext,
      organizationId: orgId,
      preferredOrgId: orgId,
      userAgent: input.userAgent,
      ip: input.ip,
    });
  }
}
