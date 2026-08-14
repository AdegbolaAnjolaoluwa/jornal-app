// ===== Service worker registration + update handling =====
import { state } from "./state.js";

// Registers the app-shell service worker so repeat visits load
// instantly and the app is installable. Never blocks anything above -
// registration failing (unsupported browser, etc.) is silently fine.
export function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  let swRegistration = null;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        swRegistration = reg;
      })
      .catch(() => {});
  });

  // sw.js posts this once a new version has activated (see its
  // "activate" handler). Reloading picks up the new shell immediately
  // instead of only on the browser's own next background update check
  // (spec default: roughly once a day) - but never while there's
  // something the reload would lose: an in-progress recording, or
  // unsaved composer text.
  let swUpdateReload = null;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "SW_UPDATED") return;
    swUpdateReload = () => window.location.reload();
    maybeApplyPendingSwUpdate();
  });

  function isSafeToReloadForUpdate() {
    const mode = state.composerMode;
    if (mode === "recording" || mode === "paused" || mode === "previewing") return false;
    const textInput = document.getElementById("textInput");
    if (textInput && textInput.value.trim().length > 0) return false;
    return true;
  }

  function maybeApplyPendingSwUpdate() {
    if (swUpdateReload && isSafeToReloadForUpdate()) {
      swUpdateReload();
    }
  }

  // Composer text and recording state both change on user input, not
  // on a fixed schedule, so re-check opportunistically on the moments
  // most likely to have just become safe.
  document.getElementById("textInput")?.addEventListener("blur", maybeApplyPendingSwUpdate);

  // Actively asks the browser to re-fetch sw.js and compare it
  // byte-for-byte against the installed one, rather than waiting on
  // the browser's own periodic check - this is what makes a tab left
  // open for a while still notice a push within minutes instead of
  // hours. Cheap (a single small-file HTTP request) and only runs
  // while the tab is actually visible.
  function checkForSwUpdate() {
    swRegistration?.update().catch(() => {});
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForSwUpdate();
      maybeApplyPendingSwUpdate();
    }
  });

  setInterval(() => {
    if (document.visibilityState === "visible") checkForSwUpdate();
  }, 5 * 60 * 1000);
}
