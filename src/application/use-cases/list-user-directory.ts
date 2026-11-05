import { UserRepository } from '../../domain/repositories';

export interface UserDirectoryItem {
  id: string;
  email: string;
  fullName: string | null;
  avatarFileId: string | null;
}

/**
 * Directorio mínimo de la organización: quién trabaja en ella, para elegir responsables, miembros o seguidores (proyectos y
 * tareas, y lo que venga). Existe aparte de `GET /users` porque ese listado pide `user:read` y entrega roles, permisos y
 * establecimientos —datos de administración—, mientras que en un tablero cualquier miembro tiene que poder asignar una tarea a
 * un compañero sin ser administrador. Aquí solo sale lo que un compañero ya ve en la aplicación: nombre, correo y foto.
 *
 * Solo usuarios activos: a uno deshabilitado no se le asigna trabajo nuevo.
 */
export class ListUserDirectoryUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(organizationId: string): Promise<UserDirectoryItem[]> {
    const users = await this.users.listByOrganization(organizationId);
    return users
      .filter((u) => u.status === 'active')
      .map((u) => ({ id: u.id, email: u.email, fullName: u.fullName, avatarFileId: u.avatarFileId }))
      .sort((a, b) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email, 'es'));
  }
}
