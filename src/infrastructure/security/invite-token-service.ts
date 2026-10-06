import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  InviteTokenService as InviteTokenServicePort,
  InviteTokenPayload,
  InviteTokenReader,
} from '../../application/ports';
import { InvalidInviteTokenError } from '../../domain/errors';
import { readLegacyInviteToken } from '../../application/legacy-invite-token';

/**
 * Token de invitación SIN firma: el JSON `{uid, oid}` en base64. Cualquiera que conociera el id de un usuario y el de su
 * organización podía fabricar la invitación y ponerle contraseña a una cuenta pendiente. Se conserva solo para las pruebas
 * y para leer invitaciones viejas durante la transición (ver SignedInviteTokenService).
 */
export class SimpleInviteTokenService implements InviteTokenServicePort {
  constructor(private readonly frontendUrl: string) {}

  generateInviteToken(payload: InviteTokenPayload): string {
    const token = Buffer.from(
      JSON.stringify({ uid: payload.userId, oid: payload.organizationId }),
    ).toString('base64url');
    return `${this.frontendUrl}/accept-invite?token=${token}`;
  }
}

export interface SignedInviteTokenOptions {
  frontendUrl: string;
  /** Secreto de firma. Si no se da, se deriva de la clave privada JWT (que solo conoce auth-service). */
  secret?: string;
  /** Respaldo para derivar la clave cuando no hay `secret`. */
  jwtPrivateKey?: string;
  /** Vigencia de la invitación, en segundos. Por defecto 7 días. */
  ttlSeconds?: number;
  /** Aceptar todavía invitaciones viejas sin firma (transición). Cada uso se avisa por `onLegacyToken`. */
  allowLegacy?: boolean;
  onLegacyToken?: (userId: string) => void;
  now?: () => number;
}

const VERSION = 'v2';
const DEFAULT_TTL = 7 * 24 * 3600;

/**
 * Token de invitación firmado y con caducidad:  v2.<carga base64url>.<firma base64url>
 *   carga = { uid, oid, exp }   firma = HMAC-SHA256(clave, "v2." + carga)
 * Quien no tenga la clave no puede fabricar ni alterar una invitación, y vence solo.
 */
export class SignedInviteTokenService implements InviteTokenServicePort, InviteTokenReader {
  private readonly key: Buffer;
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(private readonly opts: SignedInviteTokenOptions) {
    const material = opts.secret ?? (opts.jwtPrivateKey ? `invite-token-v1:${opts.jwtPrivateKey}` : '');
    if (!material) throw new Error('SignedInviteTokenService necesita `secret` o `jwtPrivateKey`.');
    this.key = createHash('sha256').update(material).digest();
    this.ttl = opts.ttlSeconds ?? DEFAULT_TTL;
    this.now = opts.now ?? (() => Date.now());
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(`${VERSION}.${body}`).digest('base64url');
  }

  generateInviteToken(payload: InviteTokenPayload): string {
    const exp = Math.floor(this.now() / 1000) + this.ttl;
    const body = Buffer.from(JSON.stringify({ uid: payload.userId, oid: payload.organizationId, exp })).toString('base64url');
    return `${this.opts.frontendUrl}/accept-invite?token=${VERSION}.${body}.${this.sign(body)}`;
  }

  read(token: string): { userId: string; organizationId: string } {
    if (!token.startsWith(`${VERSION}.`)) {
      if (!this.opts.allowLegacy) throw new InvalidInviteTokenError('La invitación es de una versión anterior. Pide que te la reenvíen.');
      const legacy = readLegacyInviteToken(token);
      this.opts.onLegacyToken?.(legacy.userId);
      return legacy;
    }

    const parts = token.split('.');
    if (parts.length !== 3) throw new InvalidInviteTokenError();
    const [, body, signature] = parts;

    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new InvalidInviteTokenError();

    let payload: { uid?: unknown; oid?: unknown; exp?: unknown };
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    } catch {
      throw new InvalidInviteTokenError();
    }
    if (typeof payload.uid !== 'string' || typeof payload.oid !== 'string' || typeof payload.exp !== 'number') {
      throw new InvalidInviteTokenError();
    }
    if (this.now() / 1000 >= payload.exp) {
      throw new InvalidInviteTokenError('La invitación caducó. Pide que te la reenvíen.');
    }
    return { userId: payload.uid, organizationId: payload.oid };
  }
}
