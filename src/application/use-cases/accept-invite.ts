import { Repositories, RefreshTokenRepository } from '../../domain/repositories';
import { Credential } from '../../domain/entities';
import { UserNotFoundError, InvalidInviteTokenError, MembershipNotInvitedError, CredentialAlreadyExistsError } from '../../domain/errors';
import { PasswordHasher, UnitOfWork, TokenService, AccessContextResolver } from '../ports';
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
  ) {}

  async execute(input: AcceptInviteInput) {
    const raw = Buffer.from(input.token, 'base64url').toString('utf-8');
    let payload: { uid: string; oid: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new InvalidInviteTokenError();
    }
    const { uid: userId, oid: organizationId } = payload;
    if (!userId || !organizationId) {
      throw new InvalidInviteTokenError();
    }

    const { credential } = await this.uow.execute(async (repos: Repositories) => {
      const user = await repos.users.findById(userId);
      if (!user) throw new UserNotFoundError();

      const existing = await repos.credentials.findByUserId(userId);
      if (existing) throw new CredentialAlreadyExistsError();

      const membership = await repos.memberships.find(userId, organizationId);
      if (!membership || membership.status !== 'invited') {
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
