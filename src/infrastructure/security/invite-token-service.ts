import type { InviteTokenService as InviteTokenServicePort, InviteTokenPayload } from '../../application/ports';

export class SimpleInviteTokenService implements InviteTokenServicePort {
  constructor(private readonly frontendUrl: string) {}

  generateInviteToken(payload: InviteTokenPayload): string {
    const token = Buffer.from(
      JSON.stringify({ uid: payload.userId, oid: payload.organizationId }),
    ).toString('base64url');
    return `${this.frontendUrl}/accept-invite?token=${token}`;
  }
}
