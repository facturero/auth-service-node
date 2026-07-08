import { Channel, ChannelModel, connect, ConsumeMessage } from 'amqplib';
import { OrganizationRepository } from '../../domain/repositories';
import { Organization } from '../../domain/rbac';
import { buildRepositories } from '../persistence/repositories';

const EXCHANGE = 'crm.events';

export class OrgUpdatedConsumer {
  private model: ChannelModel | null = null;
  private channel: Channel | null = null;

  async start(rabbitmqUrl: string): Promise<void> {
    this.model = await connect(rabbitmqUrl);
    this.channel = await this.model.createChannel();
    await this.channel.assertExchange(EXCHANGE, 'topic', { durable: true });

    const { queue } = await this.channel.assertQueue('auth-service.org.updated', {
      durable: true,
      exclusive: false,
    });

    await this.channel.bindQueue(queue, EXCHANGE, 'organization.org.updated');
    await this.channel.consume(queue, (msg: ConsumeMessage | null) => {
      if (!msg) return;
      this.handle(msg).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[org-updated-consumer] error:', err);
        this.channel!.nack(msg, false, true);
      });
    });
  }

  async stop(): Promise<void> {
    await this.channel?.close();
    await this.model?.close();
  }

  private async handle(msg: ConsumeMessage): Promise<void> {
    if (!this.channel) return;

    const payload: Record<string, unknown> = JSON.parse(msg.content.toString());
    const organizationId = payload.organizationId as string | undefined;

    if (!organizationId) {
      this.channel.nack(msg, false, false);
      return;
    }

    const repos = buildRepositories();
    const orgRepo: OrganizationRepository = repos.organizations;

    let org = await orgRepo.findById(organizationId);
    if (org) {
      const updates: Record<string, unknown> = {};
      const countryCode = (payload.countryCode as string | null) ?? org.countryCode;
      const name = (payload.legalName as string | null) ?? (payload.name as string | null) ?? org.name;

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
        name: (payload.legalName ?? payload.name) as string | null ?? null,
        countryCode: payload.countryCode as string | null ?? null,
      });
      await orgRepo.save(org);
    }

    this.channel.ack(msg);
  }
}