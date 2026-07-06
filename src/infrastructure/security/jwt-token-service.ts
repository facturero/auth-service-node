import { createHash, randomBytes } from 'node:crypto';
import { importPKCS8, importSPKI, jwtVerify, KeyLike, SignJWT } from 'jose';
import {
  AccessTokenClaims,
  GeneratedRefreshToken,
  IssuedAccessToken,
  TokenService,
} from '../../application/ports';
import { UnauthorizedError } from '../../domain/errors';
import { AppConfig } from '../config';

const ALG = 'RS256';

/**
 * TokenService basado en jose.
 *  - Access token: JWT RS256 firmado con la clave privada; se verifica con la
 *    pública (que pueden compartir el gateway y otros servicios).
 *  - Refresh token: valor opaco aleatorio; en la base vive solo su hash SHA-256.
 *
 * Se construye con `createJwtTokenService` porque la importación de claves es async.
 */
class JwtTokenService implements TokenService {
  constructor(
    private readonly privateKey: KeyLike,
    private readonly publicKey: KeyLike,
    private readonly cfg: Pick<
      AppConfig,
      'JWT_ACCESS_TTL' | 'JWT_REFRESH_TTL' | 'JWT_ISSUER' | 'JWT_AUDIENCE'
    >,
  ) {}

  async issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    const token = await new SignJWT({
      email: claims.email,
      org_id: claims.orgId ?? null,
      country_code: claims.countryCode ?? null,
      permissions: claims.permissions ?? [],
      pv: claims.pv ?? 0,
      token_use: 'access',
    })
      .setProtectedHeader({ alg: ALG, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setAudience(this.cfg.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.cfg.JWT_ACCESS_TTL}s`)
      .sign(this.privateKey);

    return { token, expiresIn: this.cfg.JWT_ACCESS_TTL };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: this.cfg.JWT_ISSUER,
        audience: this.cfg.JWT_AUDIENCE,
      });
      if (!payload.sub || typeof payload.email !== 'string') {
        throw new UnauthorizedError();
      }
      return {
        sub: payload.sub,
        email: payload.email as string,
        orgId: (payload.org_id as string | null) ?? null,
        countryCode: (payload.country_code as string | null) ?? null,
        permissions: Array.isArray(payload.permissions) ? payload.permissions as string[] : [],
        pv: typeof payload.pv === 'number' ? payload.pv : 0,
      };
    } catch {
      throw new UnauthorizedError();
    }
  }

  generateRefreshToken(): GeneratedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      hash: this.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + this.cfg.JWT_REFRESH_TTL * 1000),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

export async function createJwtTokenService(cfg: AppConfig): Promise<TokenService> {
  const [privateKey, publicKey] = await Promise.all([
    importPKCS8(cfg.JWT_PRIVATE_KEY, ALG),
    importSPKI(cfg.JWT_PUBLIC_KEY, ALG),
  ]);
  return new JwtTokenService(privateKey, publicKey, cfg);
}
