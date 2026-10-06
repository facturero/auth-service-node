import { InvalidInviteTokenError } from '../domain/errors';

/**
 * Lee el formato VIEJO del token de invitación: el JSON `{uid, oid}` en base64 SIN firma. Solo existe para las pruebas y
 * para aceptar invitaciones ya enviadas durante la transición (ver SignedInviteTokenService): no autentica nada.
 */
export function readLegacyInviteToken(token: string): { userId: string; organizationId: string } {
  let payload: { uid?: unknown; oid?: unknown };
  try {
    payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
  } catch {
    throw new InvalidInviteTokenError();
  }
  if (typeof payload.uid !== 'string' || typeof payload.oid !== 'string' || !payload.uid || !payload.oid) {
    throw new InvalidInviteTokenError();
  }
  return { userId: payload.uid, organizationId: payload.oid };
}
