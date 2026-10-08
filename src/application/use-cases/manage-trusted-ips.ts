import { Repositories, TrustedIp } from '../../domain/repositories';
import { UnitOfWork } from '../ports';

export class TrustedIpAlreadyExistsError extends Error {
  constructor(readonly ip: string) {
    super(`La IP ${ip} ya está registrada.`);
    this.name = 'TrustedIpAlreadyExistsError';
  }
}

export class TrustedIpNotFoundError extends Error {
  constructor() {
    super('IP no encontrada.');
    this.name = 'TrustedIpNotFoundError';
  }
}

/**
 * Alta, cambio y baja de IPs de confianza (las que el gateway deja pasar con un límite de peticiones más holgado).
 *
 * Existe como caso de uso, y no como llamadas directas al repositorio desde el controlador, para que cada cambio deje su
 * evento en la bitácora en la MISMA transacción: añadir una IP al "saltarse" el límite es justo lo que una auditoría
 * debe poder responder («¿quién la puso y cuándo?»). Las IPs de confianza son de plataforma, no de una organización,
 * así que los eventos no llevan `organizationId`.
 */
export class ManageTrustedIpsUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async create(input: { ip: string; label?: string | null; enabled?: boolean }): Promise<TrustedIp> {
    return this.uow.execute(async (repos: Repositories) => {
      if (await repos.trustedIps.findByIp(input.ip)) throw new TrustedIpAlreadyExistsError(input.ip);

      const entry = await repos.trustedIps.create({
        id: crypto.randomUUID(),
        ip: input.ip,
        label: input.label ?? null,
        enabled: input.enabled ?? true,
      });
      await repos.outbox.add({
        type: 'identity.trusted_ip.created',
        aggregateType: 'trusted_ip',
        aggregateId: entry.id,
        payload: { targetId: entry.id, ip: entry.ip, label: entry.label, enabled: entry.enabled },
        occurredAt: new Date(),
      });
      return entry;
    });
  }

  async update(id: string, changes: { ip?: string; label?: string; enabled?: boolean }): Promise<TrustedIp> {
    return this.uow.execute(async (repos: Repositories) => {
      const before = (await repos.trustedIps.findAll()).find((e) => e.id === id);
      if (!before) throw new TrustedIpNotFoundError();

      const { ip: previousIp, label: previousLabel, enabled: previousEnabled } = before;
      const updated = await repos.trustedIps.update(id, changes);
      if (!updated) throw new TrustedIpNotFoundError();

      await repos.outbox.add({
        type: 'identity.trusted_ip.updated',
        aggregateType: 'trusted_ip',
        aggregateId: id,
        payload: {
          targetId: id,
          ip: updated.ip,
          label: updated.label,
          enabled: updated.enabled,
          previous: { ip: previousIp, label: previousLabel, enabled: previousEnabled },
        },
        occurredAt: new Date(),
      });
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.uow.execute(async (repos: Repositories) => {
      const before = (await repos.trustedIps.findAll()).find((e) => e.id === id);
      if (!before) throw new TrustedIpNotFoundError();

      await repos.trustedIps.delete(id);
      await repos.outbox.add({
        type: 'identity.trusted_ip.deleted',
        aggregateType: 'trusted_ip',
        aggregateId: id,
        payload: { targetId: id, ip: before.ip, label: before.label },
        occurredAt: new Date(),
      });
    });
  }
}
