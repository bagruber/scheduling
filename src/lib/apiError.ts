export class ApiError extends Error {
  status: number;
  needsPassword: boolean;

  constructor(status: number, message: string, needsPassword: boolean) {
    super(message);
    this.status = status;
    this.needsPassword = needsPassword;
  }
}
