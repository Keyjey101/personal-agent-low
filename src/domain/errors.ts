export class GlmUnavailableError extends Error {
  constructor(message = 'GLM unavailable') { super(message); this.name = 'GlmUnavailableError'; }
}

export class GlmLimitError extends Error {
  constructor(message = 'GLM daily token limit exceeded') { super(message); this.name = 'GlmLimitError'; }
}

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}
