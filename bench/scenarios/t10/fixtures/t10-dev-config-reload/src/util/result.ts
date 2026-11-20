export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(error: Error): Result<T> => ({ ok: false, error });
