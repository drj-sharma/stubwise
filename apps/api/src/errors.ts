import type { z } from 'zod';

/** An error the client caused or can act on. Anything else becomes a 500 with no detail leaked. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parseOrThrow<Schema extends z.ZodType>(schema: Schema, value: unknown): z.infer<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      'invalid_request',
      'The request body is not valid.',
      result.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
