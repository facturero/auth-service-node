import type { PasswordResetLinkService } from '../../application/ports';

/** Construye el enlace del correo "restaurar contraseña" apuntando al frontend. */
export class SimplePasswordResetLinkService implements PasswordResetLinkService {
  constructor(private readonly frontendUrl: string) {}

  buildResetLink(token: string): string {
    return `${this.frontendUrl}/restablecer-contrasena?token=${encodeURIComponent(token)}`;
  }
}
