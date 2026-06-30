/**
 * Result<T, E>: representa el resultado de una operación que puede fallar
 * sin recurrir a excepciones. Útil en la capa de aplicación para flujos
 * esperados (ej. credenciales inválidas) frente a errores inesperados.
 *
 * En este servicio los casos de uso lanzan errores de dominio (AppError)
 * que el manejador HTTP traduce a respuestas; Result queda disponible por
 * si prefieres un estilo funcional en algún caso puntual.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;

export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;
