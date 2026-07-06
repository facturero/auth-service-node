/**
 * Errores de dominio. Todos extienden AppError, que lleva un `code`
 * (legible por máquina), un `httpStatus` sugerido y `details` opcionales.
 * El manejador HTTP traduce AppError -> respuesta { code, message, details }.
 */

export interface ErrorDetail {
  field: string;
  message: string;
}

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: ErrorDetail[];

  constructor(message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 422;
  constructor(details: ErrorDetail[], message = 'La petición no es válida.') {
    super(message, details);
  }
}

export class InvalidEmailError extends AppError {
  readonly code = 'INVALID_EMAIL';
  readonly httpStatus = 422;
  constructor(message = 'Email inválido.') {
    super(message);
  }
}

export class EmailAlreadyExistsError extends AppError {
  readonly code = 'EMAIL_ALREADY_EXISTS';
  readonly httpStatus = 409;
  constructor(message = 'El email ya está registrado.') {
    super(message);
  }
}

export class InvalidIdentificationError extends AppError {
  readonly code = 'INVALID_IDENTIFICATION';
  readonly httpStatus = 422;
  constructor(message = 'La identificación no es válida.') {
    super(message);
  }
}

export class IdentificationAlreadyExistsError extends AppError {
  readonly code = 'IDENTIFICATION_ALREADY_EXISTS';
  readonly httpStatus = 409;
  constructor(message = 'La cédula ya está registrada.') {
    super(message);
  }
}

export class InvalidCredentialsError extends AppError {
  readonly code = 'INVALID_CREDENTIALS';
  readonly httpStatus = 401;
  constructor(message = 'Email o contraseña incorrectos.') {
    super(message);
  }
}

export class InvalidGoogleTokenError extends AppError {
  readonly code = 'INVALID_GOOGLE_TOKEN';
  readonly httpStatus = 401;
  constructor(message = 'El token de Google no es válido.') {
    super(message);
  }
}

export class InvalidRefreshTokenError extends AppError {
  readonly code = 'INVALID_REFRESH_TOKEN';
  readonly httpStatus = 401;
  constructor(message = 'El refresh token no es válido.') {
    super(message);
  }
}

export class AccountDisabledError extends AppError {
  readonly code = 'ACCOUNT_DISABLED';
  readonly httpStatus = 403;
  constructor(message = 'La cuenta está deshabilitada.') {
    super(message);
  }
}

export class UnauthorizedError extends AppError {
  readonly code = 'UNAUTHORIZED';
  readonly httpStatus = 401;
  constructor(message = 'Token ausente o inválido.') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  constructor(message = 'Permiso insuficiente.') { super(message); }
}

export class UserNotFoundError extends AppError {
  readonly code = 'USER_NOT_FOUND'; readonly httpStatus = 404;
  constructor(message = 'Usuario no encontrado.') { super(message); }
}

export class RoleNotFoundError extends AppError {
  readonly code = 'ROLE_NOT_FOUND'; readonly httpStatus = 404;
  constructor(message = 'Rol no encontrado.') { super(message); }
}

export class NotOrganizationMemberError extends AppError {
  readonly code = 'NOT_ORG_MEMBER'; readonly httpStatus = 403;
  constructor(message = 'El usuario no pertenece a esa organización.') { super(message); }
}

export class NoActiveOrganizationError extends AppError {
  readonly code = 'NO_ACTIVE_ORGANIZATION';
  readonly httpStatus = 409;
  constructor(message = 'El usuario no tiene una organización activa.') { super(message); }
}

export class LastAdminRemovalError extends AppError {
  readonly code = 'LAST_ADMIN_REMOVAL';
  readonly httpStatus = 409;
  constructor(message = 'No se puede eliminar el último administrador de la organización.') { super(message); }
}
