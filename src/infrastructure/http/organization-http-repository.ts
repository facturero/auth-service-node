import { Organization } from '../../domain/rbac';
import { OrganizationRepository } from '../../domain/repositories';

/**
 * auth-service llama a organization-service directo (server-to-server), así
 * que tiene que poner ella misma las cabeceras que organization-service
 * espera del gateway (ver organization-service/src/interface/http/middlewares.ts).
 *
 * Reemplaza al read-model local de `organizations` SOLO para GetMeUseCase:
 * ese read-model se llena vía el consumer de `organization.org.updated`, que
 * puede tardar hasta ~30s en propagar tras completar el perfil de la
 * organización — mientras tanto, `GET /auth/me` seguía devolviendo
 * `orgName: null`, y el router del frontend rebotaba al usuario de vuelta a
 * "Configuración de organización" aunque el perfil ya estuviera guardado.
 * Consultando a organization-service en el momento (que ya tiene el dato
 * síncronamente desde el propio PUT) elimina esa ventana de latencia.
 *
 * Los demás usos de OrganizationRepository (disable-user, request-password-reset,
 * el propio consumer que escribe) siguen contra el read-model local — no
 * necesitan `name` en tiempo real, y `.save()` no aplica aquí (por eso lanza).
 */
export class OrganizationHttpRepository implements OrganizationRepository {
  constructor(private readonly baseUrl: string) {}

  async findById(id: string): Promise<Organization | null> {
    try {
      const res = await fetch(`${this.baseUrl}/organizations/me`, {
        headers: {
          'X-Organization-Id': id,
          'X-Permissions': 'organization:read',
        },
      });

      if (!res.ok) {
        console.warn(`[auth][org-http-repo] organization-service respondió ${res.status} para org ${id}`);
        return null;
      }

      const data = (await res.json()) as { legalName: string | null; countryCode: string | null };
      return Organization.create({ id, name: data.legalName, countryCode: data.countryCode });
    } catch (err) {
      console.warn('[auth][org-http-repo] No se pudo contactar a organization-service:', err);
      return null;
    }
  }

  async save(): Promise<void> {
    throw new Error('OrganizationHttpRepository es de solo lectura — no soporta save().');
  }
}
