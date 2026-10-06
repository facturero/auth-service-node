import { Repositories } from '../../domain/repositories';
import { UnitOfWork } from '../ports';
import { RoleNotFoundError, CannotModifySystemRoleError, RoleInUseError } from '../../domain/errors';

export interface DeleteRoleInput {
  organizationId: string;
  roleId: string;
}

/**
 * Borra un rol creado por la organización. Solo roles propios y personalizados:
 *  - de otra organización (o de plantilla global) se responde "no encontrado", sin revelar que existe;
 *  - los de sistema (Administrador, Vendedor…) no se tocan: el resto del sistema asume que existen;
 *  - un rol que alguien tiene asignado no se borra: dejaría a esos usuarios sin permisos sin que nadie lo decida.
 */
export class DeleteRoleUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: DeleteRoleInput): Promise<void> {
    await this.uow.execute(async (repos: Repositories) => {
      const role = await repos.roles.findById(input.roleId);
      if (!role || role.organizationId !== input.organizationId) throw new RoleNotFoundError();
      if (role.isSystem) throw new CannotModifySystemRoleError('Los roles de sistema no se pueden eliminar.');

      const holders = await repos.userRoles.listUserIdsByRole(role.id);
      if (holders.length > 0) throw new RoleInUseError(holders.length);

      await repos.roles.delete(role.id);

      // Mismo trato que crear/editar un rol: queda en la bitácora de auditoría.
      await repos.outbox.add({
        type: 'identity.role.deleted',
        aggregateType: 'role',
        aggregateId: role.id,
        payload: {
          roleId: role.id,
          organizationId: input.organizationId,
          name: role.name,
        },
        occurredAt: new Date(),
      });
    });
  }
}
