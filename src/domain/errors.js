/** Domain errors. Interfaces (HTTP, CLI) translate them to their own error formats. */
export class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR', status = 400) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
  }
}
export class ValidationError extends DomainError {
  constructor(message, details) { super(message, 'VALIDATION', 422); this.details = details; }
}
export class NotFoundError extends DomainError {
  constructor(what, id) { super(`${what} not found: ${id}`, 'NOT_FOUND', 404); }
}
export class ConflictError extends DomainError {
  constructor(message) { super(message, 'CONFLICT', 409); }
}
export class ForbiddenError extends DomainError {
  constructor(message) { super(message, 'FORBIDDEN', 403); }
}
