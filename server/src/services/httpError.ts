export class HttpError extends Error {
  status: number;
  body: string | undefined;

  constructor(status: number, message: string, body?: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}
