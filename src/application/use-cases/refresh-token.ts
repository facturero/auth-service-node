import { InvalidRefreshTokenError, AccountDisabledError } from '../../domain/errors';
import { AccessContextResolver, TokenService, UnitOfWork } from '../ports';
import { DeviceRefreshToken } from '../../domain/entities';
import { Repositories } from '../../domain/repositories';
import { DeviceSessionOutput, RefreshInput, SessionOutput } from '../dtos';
import { issueDeviceSession, issueSession } from '../session';

/**
 * Renueva el access token rotando el refresh token:
 * revoca el actual (apuntando al nuevo) y emite uno nuevo, de forma atómica.
 * Si el token recibido ya estaba revocado, se considera posible reuso.
 *
 * Soporta dos tipos de sesión:
 *  - Usuario humano: refresh token ligado a una Credential (`refresh_tokens`).
 *  - Terminal POS: refresh token ligado a un PosDevice (`device_refresh_tokens`),
 *    que devuelve una DeviceSessionOutput sin `user` humano.
 */
export class RefreshTokenUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tokenService: TokenService,
    private readonly accessContext: AccessContextResolver,
  ) {}

  async execute(input: RefreshInput): Promise<SessionOutput | DeviceSessionOutput> {
    const hash = this.tokenService.hashRefreshToken(input.refreshToken);

    return this.uow.execute(async (repos) => {
      const deviceCurrent = await repos.deviceRefreshTokens.findByHash(hash);
      if (deviceCurrent) {
        return this.renewDeviceSession(deviceCurrent, repos);
      }

      const current = await repos.refreshTokens.findByHash(hash);
      if (!current || !current.isActive()) {
        throw new InvalidRefreshTokenError();
      }

      const credential = await repos.credentials.findById(current.credentialId);
      if (!credential) {
        throw new InvalidRefreshTokenError();
      }
      if (!credential.isActive()) {
        throw new AccountDisabledError();
      }

      // Emitir la nueva sesión (genera y persiste el nuevo refresh token).
      const session = await issueSession({
        credential,
        tokenService: this.tokenService,
        refreshTokens: repos.refreshTokens,
        authProvider: credential.hasPassword() ? 'password' : 'google',
        accessContext: this.accessContext,
        userAgent: input.userAgent,
        ip: input.ip,
      });

      // Revocar el anterior, encadenando con el nuevo (rotación).
      const newHash = this.tokenService.hashRefreshToken(session.refreshToken);
      const replacement = await repos.refreshTokens.findByHash(newHash);
      current.revoke(replacement ? replacement.id : null);
      await repos.refreshTokens.save(current);

      return session;
    });
  }

  private async renewDeviceSession(
    current: DeviceRefreshToken,
    repos: Repositories,
  ): Promise<DeviceSessionOutput> {
    if (!current.isActive()) {
      throw new InvalidRefreshTokenError();
    }

    const device = await repos.posDevices.findById(current.posDeviceId);
    if (!device) {
      throw new InvalidRefreshTokenError();
    }

    const session = await issueDeviceSession({
      device,
      repos,
      tokenService: this.tokenService,
      deviceRefreshTokens: repos.deviceRefreshTokens,
    });

    const newHash = this.tokenService.hashRefreshToken(session.refreshToken);
    const replacement = await repos.deviceRefreshTokens.findByHash(newHash);
    current.revoke(replacement ? replacement.id : null);
    await repos.deviceRefreshTokens.save(current);

    return session;
  }
}
