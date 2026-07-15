/**
 * Response utilities: standardized API responses and error handling
 */

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
