import { EventHandler } from '@facturero/outbox-relay';
import { OrganizationRepository } from '../../domain/repositories';
import { Organization } from '../../domain/rbac';
import { buildRepositories } from '../persistence/repositories';

/**
 * Handler para `organization.org.updated`: sincroniza el read-model de
 * organizaciones en auth-service con los datos maestros publicados por
 * organization-service. La idempotencia, los reintentos y el registro en
 * `processed_events` los gestiona el InboxConsumer del paquete.
 */
export const orgUpdatedHandler: EventHandler = {
  eventType: 'organization.org.updated',
  async handle(payload: unknown): Promise<void> {
    const data = payload as Record<string, unknown>;
    const organizationId = data.organizationId as string | undefined;

    if (!organizationId) {
      throw new Error('payload sin organizationId');
    }

    const repos = buildRepositories();
    const orgRepo: OrganizationRepository = repos.organizations;

    let org = await orgRepo.findById(organizationId);
    if (org) {
      const updates: Record<string, unknown> = {};
      const countryCode = (data.countryCode as string | null) ?? org.countryCode;
      const name = (data.legalName as string | null) ?? (data.name as string | null) ?? org.name;

      if (countryCode !== org.countryCode) updates.countryCode = countryCode;
      if (name !== org.name) updates.name = name;

      if (Object.keys(updates).length > 0) {
        org = Organization.fromPersistence({
          ...org.toPersistence(),
          ...updates,
        });
        await orgRepo.save(org);
      }
    } else {
      org = Organization.create({
        id: organizationId,
        name: (data.legalName ?? data.name) as string | null ?? null,
        countryCode: data.countryCode as string | null ?? null,
      });
      await orgRepo.save(org);
    }
  },
};
