import { UserDashboardRepository } from '../../domain/repositories';

export interface SaveMyDashboardInput {
  userId: string;
  organizationId: string;
  /** Ya validado en el borde HTTP (forma, límites y tamaño): aquí no se reinterpreta. */
  layout: unknown[];
}

/**
 * Guarda (reemplaza entero) el tablero de Inicio del usuario en su organización activa.
 *
 * No publica evento a propósito: mover o redimensionar un widget es una preferencia personal que se guarda en
 * cada arrastre, no una acción de negocio; llenaría la bitácora de ruido sin decir nada útil a un auditor.
 */
export class SaveMyDashboardUseCase {
  constructor(
    private readonly dashboards: UserDashboardRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: SaveMyDashboardInput): Promise<{ layout: unknown[] }> {
    await this.dashboards.save(input.userId, input.organizationId, input.layout, this.clock());
    return { layout: input.layout };
  }
}
