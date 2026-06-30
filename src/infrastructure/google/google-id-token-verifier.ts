import { OAuth2Client } from 'google-auth-library';
import { GoogleIdTokenVerifier, GoogleProfile } from '../../application/ports';
import { InvalidGoogleTokenError } from '../../domain/errors';

/**
 * Verifica el ID Token de Google (flujo recomendado, sin client_secret).
 * Comprueba firma, audiencia (clientId), emisor y expiración mediante la
 * librería oficial, y extrae el perfil mínimo necesario.
 */
export class GoogleIdTokenVerifierImpl implements GoogleIdTokenVerifier {
  private readonly client: OAuth2Client;

  constructor(private readonly clientId: string) {
    this.client = new OAuth2Client(clientId);
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        throw new InvalidGoogleTokenError();
      }
      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        name: payload.name,
      };
    } catch (e) {
      if (e instanceof InvalidGoogleTokenError) throw e;
      throw new InvalidGoogleTokenError();
    }
  }
}
