/**
 * Response utilities: standardized API responses and error handling
 */

/**
 * Safe message for an unexpected (non-4xx, non-intentionally-thrown) server
 * error. Every API route already catches its own known 4xx cases (401/404/
 * 422, with hand-written client-safe messages) before falling through to a
 * generic 500 handler - this is only for THAT fallback path, where the
 * caught error could be anything: a raw Postgres error ("invalid input
 * syntax for type uuid"), a driver internals string, an unexpected null
 * dereference, etc. None of that is meant for the client - it's logged via
 * console.error at the call site (so it's still fully visible in Vercel's
 * logs for debugging) and replaced here with a generic message.
 */
export function safeServerErrorMessage(fallback = "Something went wrong. Please try again.") {
  return fallback;
}

/**
 * Success response
 */
export function success(data = {}, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      success: true,
      data,
    }),
  };
}

/**
 * Error response
 */
export function error(message, statusCode = 400, details = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      success: false,
      error: {
        message,
        ...details,
      },
    }),
  };
}

/**
 * Validation error response
 */
export function validationError(fields = {}) {
  return {
    statusCode: 422,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      success: false,
      error: {
        message: "Validation failed",
        fields,
      },
    }),
  };
}

/**
 * Unauthorized response
 */
export function unauthorized(message = "Unauthorized") {
  return error(message, 401);
}

/**
 * Not found response
 */
export function notFound(resource = "Resource") {
  return error(`${resource} not found`, 404);
}

/**
 * Method not allowed response
 */
export function methodNotAllowed(method) {
  return error(`Method ${method} not allowed`, 405);
}

/**
 * Wrap handler with error catching
 */
export function withErrorHandling(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (err) {
      console.error("Handler error:", err);

      // Handle known error types
      if (err.status === 401) {
        return unauthorized(err.message);
      }

      if (err.status === 404) {
        return notFound(err.message);
      }

      if (err.status === 422) {
        return validationError(err.fields || {});
      }

      // Generic error
      return error(err.message || "Internal server error", 500);
    }
  };
}
