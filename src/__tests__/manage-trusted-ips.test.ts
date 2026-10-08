import { describe, it, expect, beforeEach } from 'vitest';
import {
  ManageTrustedIpsUseCase,
  TrustedIpAlreadyExistsError,
  TrustedIpNotFoundError,
} from '../application/use-cases/manage-trusted-ips';
import { InMemoryUnitOfWork } from './helpers';

// Poner o quitar una IP de confianza cambia el límite de peticiones que le aplica el gateway; antes no dejaba rastro.
describe('IPs de confianza dejan huella en la bitácora', () => {
  let uow: InMemoryUnitOfWork;
  let useCase: ManageTrustedIpsUseCase;

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    useCase = new ManageTrustedIpsUseCase(uow);
  });

  it('crear publica identity.trusted_ip.created con la IP y el id afectado', async () => {
    const entry = await useCase.create({ ip: '10.0.0.0/8', label: 'Oficina Quito' });

    expect(uow.outbox.events).toHaveLength(1);
    const ev = uow.outbox.events[0];
    expect(ev.type).toBe('identity.trusted_ip.created');
    expect(ev.aggregateId).toBe(entry.id);
    expect(ev.payload).toMatchObject({ targetId: entry.id, ip: '10.0.0.0/8', label: 'Oficina Quito', enabled: true });
  });

  it('una IP repetida se rechaza y no publica nada', async () => {
    await useCase.create({ ip: '1.2.3.4' });
    uow.outbox.clear();

    await expect(useCase.create({ ip: '1.2.3.4' })).rejects.toBeInstanceOf(TrustedIpAlreadyExistsError);
    expect(uow.outbox.events).toHaveLength(0);
  });

  it('modificar publica identity.trusted_ip.updated con lo anterior y lo nuevo', async () => {
    const entry = await useCase.create({ ip: '1.2.3.4', label: 'Casa', enabled: true });
    uow.outbox.clear();

    await useCase.update(entry.id, { enabled: false });

    const ev = uow.outbox.events[0];
    expect(ev.type).toBe('identity.trusted_ip.updated');
    expect(ev.payload).toMatchObject({
      targetId: entry.id,
      enabled: false,
      previous: { ip: '1.2.3.4', label: 'Casa', enabled: true },
    });
  });

  it('modificar una IP que no existe da «no encontrada» y no publica nada', async () => {
    await expect(useCase.update('no-existe', { enabled: false })).rejects.toBeInstanceOf(TrustedIpNotFoundError);
    expect(uow.outbox.events).toHaveLength(0);
  });

  it('borrar publica identity.trusted_ip.deleted conservando la IP borrada', async () => {
    const entry = await useCase.create({ ip: '9.9.9.9', label: 'DevOps' });
    uow.outbox.clear();

    await useCase.delete(entry.id);

    const ev = uow.outbox.events[0];
    expect(ev.type).toBe('identity.trusted_ip.deleted');
    expect(ev.payload).toMatchObject({ targetId: entry.id, ip: '9.9.9.9', label: 'DevOps' });
    expect(await uow.trustedIps.findByIp('9.9.9.9')).toBeNull();
  });

  it('borrar una IP que no existe da «no encontrada» y no publica nada', async () => {
    await expect(useCase.delete('no-existe')).rejects.toBeInstanceOf(TrustedIpNotFoundError);
    expect(uow.outbox.events).toHaveLength(0);
  });
});
