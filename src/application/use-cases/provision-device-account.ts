import { PosDevice } from '../../domain/entities';
import { OrganizationNotFoundError } from '../../domain/errors';
import { TokenService, UnitOfWork } from '../ports';
import { DeviceSessionOutput } from '../dtos';
import { issueDeviceSession } from '../session';

export interface ProvisionDeviceAccountInput {
  organizationId: string;
  emissionPointId: string;
  /** UUID estable del terminal (generado en el primer arranque del POS). El
   * id del pos_device ES este deviceId: así el JWT (sub) y la sala socket.io
   * del gateway (`device:<sub>`) quedan anclados a la identidad del equipo. */
  deviceId: string;
  /** Etiqueta informativa del terminal (ej. nombre del punto de emisión). */
  label?: string;
}

/**
 * Aprovisiona la identidad de un terminal POS en `pos_devices`. A diferencia
 * del viejo flujo de "cuenta de servicio", esto NO crea filas en `users`,
 * `credentials`, `organization_memberships` ni `user_roles`: el dispositivo
 * solo obtiene sus tokens (access + refresh rotatorio) para sincronizar en
 * background, sin poder loguearse como usuario humano.
 *
 * Idempotente por `deviceId`: si el dispositivo ya existe, solo emite una
 * sesión nueva (permite reintentos seguros del flujo de emparejamiento).
 * Si re-empareja a otro punto, actualiza la referencia sin crear duplicados.
 *
 * Endpoint interno (protegido por X-Internal-Secret): organization-service lo
 * llama tras validar el código TOTP del billing point.
 */
export class ProvisionDeviceAccountUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: ProvisionDeviceAccountInput): Promise<DeviceSessionOutput> {
    return this.uow.execute(async (repos) => {
      const org = await repos.organizations.findById(input.organizationId);
      if (!org) {
        throw new OrganizationNotFoundError();
      }

      let device = await repos.posDevices.findById(input.deviceId);
      if (!device) {
        device = PosDevice.create({
          id: input.deviceId,
          emissionPointId: input.emissionPointId,
          organizationId: input.organizationId,
          label: input.label,
        });
        await repos.posDevices.save(device);

        await repos.outbox.add({
          type: 'identity.pos_device.provisioned',
          aggregateType: 'pos_device',
          aggregateId: device.id,
          payload: {
            deviceId: device.id,
            emissionPointId: device.emissionPointId,
            organizationId: device.organizationId,
          },
          occurredAt: new Date(),
        });
      } else if (
        device.emissionPointId !== input.emissionPointId ||
        device.organizationId !== input.organizationId
      ) {
        device = PosDevice.fromPersistence({
          ...device.toPersistence(),
          emissionPointId: input.emissionPointId,
          organizationId: input.organizationId,
          label: input.label ?? device.label,
          updatedAt: new Date(),
        });
        await repos.posDevices.save(device);
      }

      return issueDeviceSession({
        device,
        repos,
        tokenService: this.tokenService,
        deviceRefreshTokens: repos.deviceRefreshTokens,
      });
    });
  }
}
