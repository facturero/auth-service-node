import { UserDashboardRepository } from '../../domain/repositories';

/**
 * Tablero de Inicio del usuario en su organización activa. `null` significa "nunca lo personalizó": el frontend
 * decide entonces qué tablero por defecto mostrar según los plugins activos (este servicio no los conoce).
 */
export class GetMyDashboardUseCase {
  constructor(private readonly dashboards: UserDashboardRepository) {}

  async execute(userId: string, organizationId: string): Promise<{ layout: unknown[] | null }> {
    return { layout: await this.dashboards.find(userId, organizationId) };
  }
}
