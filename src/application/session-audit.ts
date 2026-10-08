import { randomUUID } from 'node:crypto';
import { OutboxRepository } from '../domain/repositories';

/**
 * Eventos de sesión para la bitácora de auditoría: quién entró, quién falló al entrar, quién salió y quién cambió de
 * organización.
 *
 * Los nombres empiezan por `auth.session.` y NO por `identity.` a propósito: el gateway escucha `identity.#` y, ante
 * cualquier evento de identidad que lleve un usuario, invalida su caché de permisos y le manda `permissions.changed`.
 * Un inicio de sesión no debe tener ese efecto.
 *
 * Nunca llevan contraseñas ni tokens. Un fallo al registrar NO tumba el inicio de sesión: la bitácora no puede ser la
 * razón por la que nadie entra al sistema, así que el error se anota en el log y la operación sigue.
 */
export type SessionEventType =
  | 'auth.session.login_succeeded'
  | 'auth.session.login_failed'
  | 'auth.session.logout'
  | 'auth.session.org_switched';

export interface SessionEventInput {
  userId?: string | null;
  email?: string | null;
  organizationId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** password | google */
  provider?: string;
  /** Solo en login_failed: invalid_credentials | account_disabled. */
  reason?: string;
}

const MAX_USER_AGENT = 200;

export function buildSessionEvent(type: SessionEventType, input: SessionEventInput) {
  return {
    type,
    aggregateType: 'session',
    aggregateId: input.userId ?? randomUUID(),
    payload: {
      // Los campos de actor llevan nombre propio para que la bitácora los use como «quién»: en un inicio de sesión
      // quien actúa es la propia persona (en login_failed, solo el correo que se intentó).
      ...(input.userId ? { actorId: input.userId } : {}),
      ...(input.email ? { actorEmail: input.email } : {}),
      ...(input.ip ? { actorIp: input.ip } : {}),
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent.slice(0, MAX_USER_AGENT) } : {}),
    },
    occurredAt: new Date(),
  };
}

export class SessionAuditor {
  constructor(private readonly outbox: OutboxRepository) {}

  async record(type: SessionEventType, input: SessionEventInput): Promise<void> {
    try {
      await this.outbox.add(buildSessionEvent(type, input));
    } catch (err) {
      console.error(`[auth] no se pudo registrar ${type} en la bitácora:`, err);
    }
  }
}
