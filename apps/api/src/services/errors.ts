/** An error with an HTTP status, raised by services and turned into a JSON reply by the routes. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what: string, id: string) =>
  new ApiError(404, 'not_found', `${what} ${id} not found`);
