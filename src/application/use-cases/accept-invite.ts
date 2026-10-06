import { Repositories, RefreshTokenRepository } from '../../domain/repositories';
import { Credential } from '../../domain/entities';
import {
  UserNotFoundError,
  InvalidInviteTokenError,
  MembershipNotInvitedError,
  CredentialAlreadyExistsError,
  AccountDisabledError,
} from '../../domain/errors';
import { PasswordHasher, UnitOfWork, TokenService, AccessContextResolver, InviteTokenReader } from '../ports';
import { readLegacyInviteToken } from '../legacy-invite-token';
import { issueSession } from '../session';
import { AuthProvider } from '../dtos';

export interface AcceptInviteInput {
  token: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
}

export class AcceptInviteUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly tokenService: TokenService,
    private readonly accessContext: AccessContextResolver,
    private readonly refreshTokens: RefreshTokenRepository,
    /**
     * Quien valida el token (firma + caducidad). Sin él se lee el formato viejo SIN firma: solo para pruebas; en
     * producción main.ts siempre pasa el verificador firmado.
     */
    private readonly inviteTokens?: InviteTokenReader,
  ) {}

  async execute(input: AcceptInviteInput) {
    const { userId, organizationId } = this.inviteTokens
      ? this.inviteTokens.read(input.token)
      : readLegacyInviteToken(input.token);
    if (!userId || !organizationId) {
      throw new InvalidInviteTokenError();
    }

    const { credential } = await this.uow.execute(async (repos: Repositories) => {
      const user = await repos.users.findById(userId);
      if (!user) throw new UserNotFoundError();
      // Un usuario deshabilitado no puede aceptar: primero hay que habilitarlo.
      if (!user.isActive()) throw new AccountDisabledError();

      const existing = await repos.credentials.findByUserId(userId);
      if (existing) throw new CredentialAlreadyExistsError();

      // "Invitado", o "activo" SIN credencial: así quedaron las invitaciones que se deshabilitaron y habilitaron antes de
      // corregir disable-user (la membresía pasaba a activo sin que nadie hubiera puesto contraseña). Sin esto esas
      // cuentas no tenían salida; con la invitación original aceptan y quedan bien.
      const membership = await repos.memberships.find(userId, organizationId);
      if (!membership || (membership.status !== 'invited' && membership.status !== 'active')) {
        throw new MembershipNotInvitedError();
      }

      const passwordHash = await this.hasher.hash(input.password);

      const credential = Credential.create({
        userId: user.id,
        email: user.email,
        passwordHash,
        authProvider: 'password',
        emailVerified: true,
      });
      await repos.credentials.save(credential);

      membership.activate();
      await repos.memberships.save(membership);

      await repos.outbox.add({
        type: 'identity.user.accepted_invite',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: { userId: user.id, organizationId, email: user.email },
        occurredAt: new Date(),
      });

      return { credential };
    });

    return issueSession({
      credential,
      tokenService: this.tokenService,
      refreshTokens: this.refreshTokens,
      authProvider: 'password' as AuthProvider,
      accessContext: this.accessContext,
      preferredOrgId: organizationId,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    });
  }
}
