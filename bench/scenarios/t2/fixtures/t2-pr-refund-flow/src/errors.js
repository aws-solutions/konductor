export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message) => new AppError(400, 'bad_request', message);
export const forbidden = (message) => new AppError(403, 'forbidden', message);
export const notFound = (message) => new AppError(404, 'not_found', message);
export const conflict = (message) => new AppError(409, 'conflict', message);
