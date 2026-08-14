// ===== Auth =====
// Signup/signin/login/logout, signup wizard, password reset, auth error
// handling, session caching.
import { CONFIG, state, SessionExpiredError } from "./state.js";
import { authFetch, isOfflineError } from "./api.js";
import {
  trackEvent,
  identifyUser,
  showToast,
  showAlert,
  showAuthScreen,
  showGuideScreen,
  showAppScreen,
  showView,
  displayName,
  renderAvatar,
  validateEmailFormat,
  escapeHtml,
  renderThemeToggle,
  hideAuthSessionInterstitial,
  showAuthSessionInterstitial,
  switchAuthTab,
  initCurvedInput,
} from "./ui-shell.js";

// ===== Auth Functions =====
export async function handleSignup(email, password, name) {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const response = await fetch(CONFIG.api.endpoints.signup, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name, timezone }),
      credentials: "include",
    });

    const data = await response.json();

    if (!response.ok) {
      handleAuthError(data, "signup");
      return false;
    }

    state.user = data.data.user;
    cacheLastUser(state.user);
    identifyUser(state.user);
    trackEvent("signup_completed");
    showToast(`Welcome, ${displayName(state.user)}! Your account has been created.`);
    showGuideScreen();
    return true;
  } catch (error) {
    showToast(`Sign up failed: ${error.message}`, "error");
    return false;
  }
}

// ===== Signup Wizard =====
// Email -> Password -> Name -> Age, one field per step, collected here
// and only POSTed to the server once, at the final step. Each step's
// curved-input instance stays mounted (not destroyed) across
// navigation so Back can restore a prior answer synchronously via
// setValue() instead of losing it.
let signupWizardState = { step: 1, email: "", password: "", name: "" };
let signupCurvedInputs = { email: null, password: null, name: null };

function ensureCurvedInputMounted(step) {
  const configs = {
    1: { field: "email", mountId: "signupEmailMount", opts: { placeholder: "you@domain.com" } },
    2: { field: "password", mountId: "signupPasswordMount", opts: { placeholder: "••••••••", mode: "password" } },
    3: { field: "name", mountId: "signupNameMount", opts: { placeholder: "What should we call you?", maxLength: 100 } },
  };
  const config = configs[step];
  if (!config || signupCurvedInputs[config.field]) return;

  const mountEl = document.getElementById(config.mountId);
  if (!mountEl) return;

  signupCurvedInputs[config.field] = initCurvedInput(mountEl, {
    ...config.opts,
    onSubmit: advanceSignupWizard,
  });
}

export function renderSignupWizardStep() {
  const step = signupWizardState.step;
  ensureCurvedInputMounted(step);

  document.querySelectorAll(".wizard-step").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.step) === step);
  });

  document.getElementById("signupWizardProgressText").textContent = `Step ${step} of 3`;
  document.querySelectorAll(".wizard-dot").forEach((dot) => {
    const dotStep = Number(dot.dataset.step);
    dot.classList.toggle("active", dotStep === step);
    dot.classList.toggle("completed", dotStep < step);
  });

  document.getElementById("signupWizardBackBtn").style.display = step === 1 ? "none" : "";
  document.getElementById("signupWizardContinueBtn").textContent = step === 3 ? "Create account" : "Continue";

  const fieldForStep = { 1: "email", 2: "password", 3: "name" }[step];
  const instance = signupCurvedInputs[fieldForStep];
  if (instance) {
    setTimeout(() => instance.focus(), 50);
  }
}

function validateSignupStep(step) {
  if (step === 1) {
    const email = signupCurvedInputs.email.getValue().trim();
    const errorEl = document.getElementById("signup-email-error");
    if (!validateEmailFormat(email)) {
      errorEl.textContent = "Enter a valid email address";
      signupCurvedInputs.email.setError("Enter a valid email address");
      return false;
    }
    errorEl.textContent = "";
    signupCurvedInputs.email.setError(null);
    return true;
  }
  if (step === 2) {
    const password = signupCurvedInputs.password.getValue();
    const errorEl = document.getElementById("signup-password-error");
    if (password.length < 8) {
      errorEl.textContent = "Password must be at least 8 characters";
      signupCurvedInputs.password.setError("Password must be at least 8 characters");
      return false;
    }
    errorEl.textContent = "";
    signupCurvedInputs.password.setError(null);
    return true;
  }
  // Name (step 3) has no client-side validation, matching the server
  // (only a 100-char cap, enforced by the curved-input's maxLength).
  return true;
}

function persistCurrentStepValue(step) {
  if (step === 1) signupWizardState.email = signupCurvedInputs.email.getValue().trim();
  if (step === 2) signupWizardState.password = signupCurvedInputs.password.getValue();
  if (step === 3) signupWizardState.name = signupCurvedInputs.name.getValue().trim();
}

export async function advanceSignupWizard() {
  const step = signupWizardState.step;
  if (!validateSignupStep(step)) return;
  persistCurrentStepValue(step);

  if (step < 3) {
    signupWizardState.step += 1;
    renderSignupWizardStep();
  } else {
    const continueBtn = document.getElementById("signupWizardContinueBtn");
    continueBtn.disabled = true;
    try {
      await handleSignup(signupWizardState.email, signupWizardState.password, signupWizardState.name);
    } finally {
      continueBtn.disabled = false;
    }
  }
}

export function retreatSignupWizard() {
  if (signupWizardState.step <= 1) return;
  persistCurrentStepValue(signupWizardState.step);
  signupWizardState.step -= 1;
  renderSignupWizardStep();

  const fieldForStep = { 1: "email", 2: "password", 3: "name" }[signupWizardState.step];
  const instance = signupCurvedInputs[fieldForStep];
  if (instance) instance.setValue(signupWizardState[fieldForStep]);
}

export function resetSignupWizard() {
  Object.values(signupCurvedInputs).forEach((instance) => instance?.destroy());
  signupCurvedInputs = { email: null, password: null, name: null };
  signupWizardState = { step: 1, email: "", password: "", name: "" };
  document.querySelectorAll("#signupForm .form-error").forEach((el) => (el.textContent = ""));
  renderSignupWizardStep();
}

export async function handleSignin(email, password, rememberMe) {
  try {
    const response = await fetch(CONFIG.api.endpoints.login, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, rememberMe }),
      credentials: "include",
    });

    const data = await response.json();

    if (!response.ok) {
      handleAuthError(data, "signin");
      return false;
    }

    state.user = data.data.user;
    cacheLastUser(state.user);
    identifyUser(state.user);
    trackEvent("signin_completed");
    showToast(`Welcome back, ${displayName(state.user)}!`);
    enterApp();
    return true;
  } catch (error) {
    showToast(`Sign in failed: ${error.message}`, "error");
    return false;
  }
}

// Route to the guide screen if this user never finished onboarding
// (e.g. they closed the tab right after signing up), otherwise straight into the app.
export function enterApp() {
  if (!state.user.onboardingCompletedAt) {
    showGuideScreen();
  } else {
    showAppScreen();
    showView("homeView");
  }
}

// Persist onboarding completion, then hand off to the normal app screen.
export async function finishOnboarding() {
  try {
    const response = await fetch(CONFIG.api.endpoints.profile, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    if (response.ok) {
      const data = await response.json();
      state.user.onboardingCompletedAt = data.data.onboardingCompletedAt;
    }
  } catch (error) {
    // Non-fatal: worst case the guide re-shows on next login
  }
  showAppScreen();
  showView("homeView");
}

export async function handleForgotPassword(email) {
  const errorEl = document.getElementById("forgot-general-error");
  const successEl = document.getElementById("forgot-success-message");
  errorEl.textContent = "";
  successEl.style.display = "none";

  if (!validateEmailFormat(email)) {
    document.getElementById("forgot-email-error").textContent = "Enter a valid email address";
    return;
  }
  document.getElementById("forgot-email-error").textContent = "";

  try {
    const response = await fetch(CONFIG.api.endpoints.requestPasswordReset, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();

    if (!response.ok) {
      errorEl.textContent = data.error?.message || "Something went wrong";
      return;
    }

    successEl.textContent = data.data.message;
    successEl.style.display = "block";

    // No email provider is wired up yet, so the API returns the link directly outside
    // production so the flow is testable end-to-end. Safe to remove once email sends for real.
    if (data.data.devResetUrl) {
      console.log("[dev] password reset link:", data.data.devResetUrl);
    }
  } catch (error) {
    errorEl.textContent = error.message;
  }
}

export async function handleResetPassword(password) {
  const errorEl = document.getElementById("reset-general-error");
  errorEl.textContent = "";

  const params = new URLSearchParams(window.location.search);
  const token = params.get("resetToken");
  if (!token) {
    errorEl.textContent = "Reset link is missing or invalid. Please request a new one.";
    return;
  }

  if (password.length < 8) {
    document.getElementById("reset-password-error").textContent = "Password must be at least 8 characters";
    return;
  }
  document.getElementById("reset-password-error").textContent = "";

  try {
    const response = await fetch(CONFIG.api.endpoints.resetPassword, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token, password }),
    });
    const data = await response.json();

    if (!response.ok) {
      errorEl.textContent = data.error?.message || "Something went wrong";
      return;
    }

    // Clear the token from the URL so a refresh doesn't try to reuse it
    window.history.replaceState({}, "", window.location.pathname);
    showToast("Password updated. You're signed in.");
    await checkAuth();
  } catch (error) {
    errorEl.textContent = error.message;
  }
}

// Signup's fields (email/password/name) each live on their own wizard
// step now, not a real <input> - a server-side error (e.g. "email
// already registered", which can only be known after the final submit)
// needs to jump the wizard back to the right step, or the error would
// land on a hidden div the user has no way to see.
const SIGNUP_FIELD_TO_STEP = { email: 1, password: 2, name: 3 };

export function handleAuthError(data, formType) {
  const errorData = data.error;

  if (errorData.fields) {
    if (formType === "signup") {
      const failingField = Object.keys(errorData.fields).find(
        (f) => errorData.fields[f] && SIGNUP_FIELD_TO_STEP[f]
      );
      if (failingField) {
        signupWizardState.step = SIGNUP_FIELD_TO_STEP[failingField];
        renderSignupWizardStep();
      }
    }

    for (const [field, message] of Object.entries(errorData.fields)) {
      if (message) {
        const errorEl = document.getElementById(`${formType}-${field}-error`);
        if (errorEl) errorEl.textContent = message;
        const inputEl = document.getElementById(`${formType}-${field}`);
        if (inputEl) inputEl.classList.add("has-error");
        if (formType === "signup" && signupCurvedInputs[field]) {
          signupCurvedInputs[field].setError(message);
        }
      }
    }
  } else {
    const generalErrorEl = document.getElementById(`${formType}-general-error`);
    if (generalErrorEl) generalErrorEl.textContent = errorData.message;
  }
}

export async function handleLogout() {
  try {
    await fetch(CONFIG.api.endpoints.logout, {
      method: "POST",
      credentials: "include",
    });

    state.user = null;
    state.isOfflineProvisional = false;
    clearCachedUser();
    document.getElementById("offlineBanner").classList.remove("active");
    if (window.POSTHOG_KEY && window.posthog) posthog.reset();
    showAuthScreen();
  } catch (error) {
    showToast(`Logout failed: ${error.message}`, "error");
  }
}

// Read-only cache of the last confirmed user object, used only to let a
// cold reload while offline show cached entries instead of a login
// screen it has no way to actually verify. This never substitutes for
// the real httpOnly session cookie or bypasses server auth - it's a
// provisional, clearly-labeled state that gets reconciled (confirmed or
// corrected) the moment a real /api/auth/me check can run again.
const USER_CACHE_KEY = "sayso_last_user_cache";

export function cacheLastUser(user) {
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch (e) {
    // Storage full/unavailable - offline cold-start just won't be available.
  }
}

function readCachedUser() {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearCachedUser() {
  try {
    localStorage.removeItem(USER_CACHE_KEY);
  } catch (e) {}
}

export async function checkAuth() {
  try {
    const response = await fetch(CONFIG.api.endpoints.me, {
      credentials: "include",
    });

    if (!response.ok) {
      // A real response from the server saying "not logged in" - trust
      // it, and stop treating any cached user as valid.
      clearCachedUser();
      showAuthScreen();
      return;
    }

    const data = await response.json();
    state.user = data.data.user;
    cacheLastUser(state.user);
    identifyUser(state.user);
    if (state.isOfflineProvisional) {
      state.isOfflineProvisional = false;
      document.getElementById("offlineBanner").classList.remove("active");
    }
    enterApp();
    loadTags();
  } catch (error) {
    // The request itself never reached the server (offline), so we
    // genuinely don't know if the session is still valid - fall back to
    // the last-known user, provisionally, rather than assuming logged out.
    const cachedUser = isOfflineError(error) ? readCachedUser() : null;
    if (cachedUser) {
      enterAppProvisionally(cachedUser);
    } else {
      showAuthScreen();
    }
  }
}

// Enters the app from a cached user object when the real session check
// couldn't reach the server at all. Always goes straight to the entries
// view (never onboarding/first-entry, which mutate server state and
// can't happen offline) and shows a persistent banner so this state is
// never mistaken for a normal, verified session.
function enterAppProvisionally(cachedUser) {
  state.user = cachedUser;
  state.isOfflineProvisional = true;
  identifyUser(state.user);
  showAppScreen();
  showView("homeView");
  document.getElementById("offlineBanner").classList.add("active");

  // The moment real connectivity returns, re-run the real check so this
  // provisional state gets confirmed or corrected - never left dangling.
  window.addEventListener(
    "online",
    () => {
      if (state.isOfflineProvisional) checkAuth();
    },
    { once: true }
  );
}

// Entry point for explicit ?tab=signin/signup navigation: checks whether
// a session already exists before deciding what to show, instead of
// blindly showing the form (checkAuth()'s job) or blindly restoring the
// session (which is what the bare "else" branch below does on purpose).
export async function showAuthTabRespectingSession(tabType) {
  try {
    const response = await fetch(CONFIG.api.endpoints.me, { credentials: "include" });
    if (response.ok) {
      const data = await response.json();
      state.user = data.data.user;
      hideAuthSessionInterstitial();
      switchAuthTab(tabType);
      if (tabType === "signup") resetSignupWizard();
      showAuthSessionInterstitial(state.user);
      return;
    }
  } catch (error) {
    // Treat a failed session check the same as "no session" - fall through to the form.
  }
  hideAuthSessionInterstitial();
  switchAuthTab(tabType);
  if (tabType === "signup") resetSignupWizard();
  showAuthScreen();
}

// ===== Settings / Facts =====
export async function loadSettings() {
  renderProfileSection();
  renderThemeToggle();
  try {
    const response = await authFetch(CONFIG.api.endpoints.facts);
    if (!response.ok) throw new Error("Failed to load facts");
    const data = await response.json();
    state.facts = data.data.facts;
    renderFacts();
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      showAlert(`Failed to load settings: ${error.message}`, "error");
    }
  }
}

export function renderProfileSection() {
  document.getElementById("profileNicknameInput").value = state.user.nickname || "";
  renderAvatar(
    document.getElementById("profilePicturePreview"),
    document.getElementById("profilePicturePlaceholder"),
    state.user
  );
}

export function renderFacts() {
  const container = document.getElementById("factsList");
  if (state.facts.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><h3>Nothing yet</h3><p>As you journal, things Say So learns about you will show up here.</p></div>';
    return;
  }
  container.innerHTML = state.facts
    .map((fact) => {
      const date = new Date(fact.created_at);
      const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return `
        <div class="fact-row">
          <div class="fact-text">${escapeHtml(fact.text)}</div>
          <div class="fact-date">${dateStr}</div>
        </div>
      `;
    })
    .join("");
}

// Loads the user's full tag vocabulary, used for autocomplete in the composer
// and the entry-detail tag editor. Safe to call before entries load.
export async function loadTags() {
  try {
    const response = await authFetch(CONFIG.api.endpoints.tags);
    if (!response.ok) throw new Error("Failed to load tags");
    const data = await response.json();
    state.tags = data.data.tags;
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      console.error("Failed to load tags:", error);
    }
  }
}
