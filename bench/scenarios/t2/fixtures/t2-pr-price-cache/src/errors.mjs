export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function notFound(label) {
  return new HttpError(404, `${label} was not found`);
}
