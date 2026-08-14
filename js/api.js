// ===== Shared fetch helpers =====
// authFetch()/isOfflineError() are used across nearly every feature module,
// so they live in their own small shared module rather than inside any one
// feature area (avoids e.g. entries.js importing from composer.js just to
// get authFetch).
import { state, SessionExpiredError } from "./state.js";
import { showAuthScreen, showToast } from "./ui-shell.js";

// True when a fetch failure was caused by having no network connection
// at all, as opposed to a real server-side error (validation failure,
// 500, etc.) - browsers throw a plain TypeError ("Failed to fetch") for
// the former, and resolve normally (with response.ok === false) for the
// latter, so this only ever fires for the true "you're offline" case.
export function isOfflineError(error) {
  return !navigator.onLine || (error instanceof TypeError && /fetch|network/i.test(error.message));
}

// Drop-in replacement for authenticated fetch() calls. On a 401, redirects to
// sign-in and throws SessionExpiredError instead of leaving the caller to fail
// ambiguously; every other response (ok or not) is returned as normal so
// existing `if (!response.ok)` handling at each call site is unaffected. A
// 20s timeout guards against a request that never resolves (e.g. dropped
// connection) so callers always get a rejected promise instead of hanging
// forever, leaving a UI stuck on a skeleton/spinner with no way out.
const AUTH_FETCH_TIMEOUT_MS = 20000;

export async function authFetch(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { ...options, credentials: "include", signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Request timed out. Please try again.");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401) {
    state.user = null;
    showAuthScreen();
    showToast("Your session expired. Please sign in again.", "error");
    throw new SessionExpiredError("Session expired");
  }
  return response;
}
