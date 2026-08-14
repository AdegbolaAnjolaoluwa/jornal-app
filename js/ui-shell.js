// ===== UI Shell =====
// View switching, theme, sidebar, toasts/alerts, and generic helpers used
// across every feature area. Also owns the light-rays / curved-input
// integration (previously a separate bolted-on <script type="module"> that
// bridged into the classic script via window.* - now that everything is a
// module, these are plain imports instead).
import { initLightRays } from "/light-rays.js";
import { initCurvedInput } from "/curved-input.js";
import { state } from "./state.js";
// Circular by nature (composer needs showAlert/clearForm's helpers from
// here, this file's clearForm/showView need composer's/entries'/etc.
// functions) - safe under ES modules because none of these are called at
// module-evaluation time, only from inside functions invoked later.
import { teardownRecordingResources, closeRecordingPreview, autoGrowTextarea, setComposerMode, renderComposerTagChips } from "./composer.js";
import { loadEntries } from "./entries.js";
import { loadTodoList } from "./action-points.js";
import { loadAskView, loadRecap } from "./ask-recap.js";
import { loadSettings } from "./auth.js";
import { loadHomeReplyThread } from "./chat.js";

export { initCurvedInput };

// ===== Analytics =====
// No-ops until window.POSTHOG_KEY is set (see <head>). Safe to call everywhere.
export function trackEvent(name, properties = {}) {
  if (window.POSTHOG_KEY && window.posthog) {
    posthog.capture(name, properties);
  }
}

export function identifyUser(user) {
  if (window.POSTHOG_KEY && window.posthog) {
    posthog.identify(user.id, { email: user.email });
  }
}

// ===== Client-side validation =====
export function validateEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateAuthForm(formType) {
  const email = document.getElementById(`${formType}-email`).value;
  const password = document.getElementById(`${formType}-password`).value;
  const emailInput = document.getElementById(`${formType}-email`);
  const passwordInput = document.getElementById(`${formType}-password`);
  const emailError = document.getElementById(`${formType}-email-error`);
  const passwordError = document.getElementById(`${formType}-password-error`);

  emailInput.classList.remove("has-error");
  passwordInput.classList.remove("has-error");
  emailError.textContent = "";
  passwordError.textContent = "";

  let valid = true;

  if (!validateEmailFormat(email)) {
    emailInput.classList.add("has-error");
    emailError.textContent = "Enter a valid email address";
    valid = false;
  }

  if (password.length < 8) {
    passwordInput.classList.add("has-error");
    passwordError.textContent = "Password must be at least 8 characters";
    valid = false;
  }

  return valid;
}

export function truncate(text, n) {
  return text && text.length > n ? text.slice(0, n) + "…" : text || "";
}

export function debounce(fn, delayMs) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };
}

// Today's date in the browser's own timezone, as YYYY-MM-DD - sent
// alongside extraction requests so the AI resolves "tomorrow"/"Friday"
// against the user's actual local date, not the server's UTC date.
export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalDateTimeInputValue(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ===== UI Functions =====
export function showAuthScreen() {
  document.getElementById("authScreen").classList.add("active");
  document.getElementById("guideScreen").classList.remove("active");
  document.getElementById("firstEntryScreen").classList.remove("active");
  document.getElementById("appScreen").classList.remove("active");
  // Re-run the light-rays effect now that the auth screen has actual
  // size (it was display:none, so the WebGL canvas had nothing to size
  // itself against) - a no-op if it's already running.
  restartAuthRays();
}

// Hides the sign-in/sign-up tabs+forms and shows "You're already signed
// in as X" instead, so an existing session can't silently swallow an
// explicit ?tab=signin/signup navigation, and the raw form isn't shown
// to someone who can't usefully submit it without logging out first.
export function showAuthSessionInterstitial(user) {
  document.getElementById("authTabs").style.display = "none";
  document.querySelectorAll(".auth-form").forEach((f) => (f.style.display = "none"));
  document.getElementById("authSessionUserLabel").textContent = displayName(user);
  document.getElementById("authSessionInterstitial").classList.add("active");
  showAuthScreen();
}

export function hideAuthSessionInterstitial() {
  document.getElementById("authSessionInterstitial").classList.remove("active");
  document.getElementById("authTabs").style.display = "";
  document.querySelectorAll(".auth-form").forEach((f) => (f.style.display = ""));
}

export function showGuideScreen() {
  document.getElementById("authScreen").classList.remove("active");
  document.getElementById("firstEntryScreen").classList.remove("active");
  document.getElementById("appScreen").classList.remove("active");
  document.getElementById("guideScreen").classList.add("active");
  trackEvent("onboarding_guide_viewed");
}

export function showFirstEntryScreen() {
  document.getElementById("authScreen").classList.remove("active");
  document.getElementById("guideScreen").classList.remove("active");
  document.getElementById("appScreen").classList.remove("active");
  document.getElementById("firstEntryScreen").classList.add("active");
  trackEvent("onboarding_first_entry_prompted");
  document.getElementById("firstEntryInput").focus();
}

export function displayName(user) {
  return user.nickname || user.name || user.email;
}

export function renderAvatar(imgEl, placeholderEl, user) {
  if (user.profilePictureDataUri) {
    imgEl.src = user.profilePictureDataUri;
    imgEl.style.display = "";
    placeholderEl.style.display = "none";
  } else {
    imgEl.style.display = "none";
    placeholderEl.textContent = displayName(user).charAt(0).toUpperCase();
    placeholderEl.style.display = "flex";
  }
}

export function showAppScreen() {
  document.getElementById("authScreen").classList.remove("active");
  document.getElementById("guideScreen").classList.remove("active");
  document.getElementById("firstEntryScreen").classList.remove("active");
  document.getElementById("appScreen").classList.add("active");
  document.getElementById("userEmail").textContent = displayName(state.user);
  renderAvatar(
    document.getElementById("headerAvatar"),
    document.getElementById("headerAvatarPlaceholder"),
    state.user
  );
}

const VIEW_HEADINGS = {
  todoView: "To-do List",
  askView: "Ask",
  recapView: "Recap",
  settingsView: "Settings",
};

const VIEW_LOADERS = {
  homeView: loadEntries,
  todoView: loadTodoList,
  askView: loadAskView,
  recapView: loadRecap,
  settingsView: loadSettings,
};

// Home is always a fresh start: never shows past entries, and the
// composer only lives here. Every other view hides the composer and
// shows a normal heading instead of the greeting block.
export function showView(viewId) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === viewId));
  document.querySelectorAll(".sidebar-link[data-view]").forEach((l) => l.classList.toggle("active", l.dataset.view === viewId));
  const heading = document.getElementById("contentHeading");
  if (viewId === "homeView" || viewId === "conversationView") {
    heading.style.display = "none";
    if (viewId === "homeView") {
      renderHomeView();
    }
  } else {
    heading.style.display = "";
    heading.textContent = VIEW_HEADINGS[viewId] ?? "";
  }
  VIEW_LOADERS[viewId]?.();

  // The rays are a WebGL animation loop - only run it while home is
  // actually the visible view, same lifecycle as the auth screen's rays.
  if (viewId === "homeView") {
    restartHomeRays();
  } else {
    stopHomeRays();
  }
}

const GREETINGS = {
  morning: [
    "Good Morning, {name} ☀️",
    "Ready to make today count?",
    "Hope you're having a great morning.",
    "Let's build something amazing today.",
  ],
  afternoon: [
    "Good Afternoon, {name} 👋",
    "Welcome back.",
    "Nice to see you again.",
    "What are we working on today?",
    "Ready for another productive session?",
  ],
  evening: [
    "Good Evening, {name} 🌙",
    "Burning the midnight oil?",
    "Hope your day has been going well.",
    "Let's finish today strong.",
  ],
};

function pickGreeting() {
  const hour = new Date().getHours();
  const bucket = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const pool = GREETINGS[bucket];
  const template = pool[Math.floor(Math.random() * pool.length)];
  return template.replace("{name}", displayName(state.user));
}

// Picks a new greeting + date each time the home view is shown, so it
// rotates across visits without jittering mid-visit.
export function renderHomeView() {
  const greeting = document.getElementById("homeGreeting");
  const dateEl = document.getElementById("homeDate");
  if (greeting) greeting.textContent = pickGreeting();
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  loadHomeReplyThread();
}

export function switchAuthTab(tabType) {
  const form = document.getElementById(`${tabType}Form`);
  if (!form) return;
  document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tabType));
  document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
  form.classList.add("active");
  document.querySelectorAll(".form-error").forEach((e) => (e.textContent = ""));
  document.querySelectorAll(".form-group input").forEach((i) => i.classList.remove("has-error"));
}

export function showAlert(message, type = "info") {
  const container = document.getElementById("alertContainer");
  const alertEl = document.createElement("div");
  alertEl.className = `alert alert-${type}`;
  alertEl.textContent = message;
  container.appendChild(alertEl);

  setTimeout(() => alertEl.remove(), 2000);
}

export function showToast(message, type = "success") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toastEl = document.createElement("div");
  toastEl.className = `toast toast-${type}`;
  toastEl.textContent = message;
  container.appendChild(toastEl);

  setTimeout(() => {
    toastEl.classList.add("toast-hide");
    setTimeout(() => toastEl.remove(), 250);
  }, 3000);
}

export function clearForm() {
  if (state.composerMode !== "idle" && state.composerMode !== "previewing") {
    teardownRecordingResources();
  }
  if (state.composerMode === "previewing") {
    closeRecordingPreview();
  }
  document.getElementById("textInput").value = "";
  autoGrowTextarea();
  setComposerMode("idle");
  state.composerTags = [];
  renderComposerTagChips();
  document.getElementById("submitBtn").disabled = true;
  document.getElementById("composer").classList.remove("has-text");
  state.currentInputType = "text";
}

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ===== Theme =====
export function applyTheme(value) {
  if (value === "light" || value === "dark") {
    document.documentElement.setAttribute("data-theme", value);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function setTheme(value) {
  localStorage.setItem("theme", value);
  applyTheme(value);
  renderThemeToggle();
  // The auth-screen and home-screen light rays pick white (dark mode)
  // vs. gray (light mode) based on the theme, so switching themes
  // needs to re-tint them too, not just the rest of the UI.
  restartAuthRays();
  restartHomeRays();
  // Same for any mounted curved-input fields (signup wizard) - each
  // instance registers a retint callback with curved-input.js.
  if (window.curvedInputRetintCallbacks) window.curvedInputRetintCallbacks.forEach((fn) => fn());
}

export function renderThemeToggle() {
  const current = localStorage.getItem("theme") || "system";
  document.querySelectorAll("#themeToggle .auth-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeValue === current);
  });
}

// ===== Sidebar collapse/expand (desktop) + mobile drawer =====
// body.sidebar-hidden drives the floating hamburger-btn's visibility
// (see its CSS) - true whenever the sidebar itself isn't showing,
// regardless of which of the two mechanisms below caused that.
export function updateSidebarHiddenClass() {
  const hidden = isMobileViewport() ? !state.sidebarMobileOpen : state.sidebarCollapsed;
  document.body.classList.toggle("sidebar-hidden", hidden);
}

export function applySidebarCollapsed(collapsed) {
  document.getElementById("appSidebar").classList.toggle("collapsed", collapsed);
  updateSidebarHiddenClass();
}

export function toggleSidebarCollapsed() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  try {
    localStorage.setItem("sayso_sidebar_collapsed", state.sidebarCollapsed ? "1" : "0");
  } catch (e) {}
  applySidebarCollapsed(state.sidebarCollapsed);
}

export function openSidebarDrawer() {
  state.sidebarMobileOpen = true;
  document.getElementById("appSidebar").classList.add("mobile-open");
  document.getElementById("sidebarBackdrop").classList.add("active");
  updateSidebarHiddenClass();
}

export function closeSidebarDrawer() {
  state.sidebarMobileOpen = false;
  document.getElementById("appSidebar").classList.remove("mobile-open");
  document.getElementById("sidebarBackdrop").classList.remove("active");
  updateSidebarHiddenClass();
}

export function isMobileViewport() {
  return window.matchMedia("(max-width: 860px)").matches;
}

// Resizing across the mobile/desktop breakpoint changes what
// "sidebar-hidden" means (drawer-closed vs. desktop-collapsed) without
// any click firing, so re-derive it directly rather than waiting for
// the next toggle.
window.addEventListener("resize", updateSidebarHiddenClass);

// ===== Light rays (auth screen + home screen) =====
let destroyAuthRays = null;

function startAuthRays() {
  if (destroyAuthRays) {
    destroyAuthRays();
    destroyAuthRays = null;
  }
  const container = document.getElementById("authRays");
  if (!container) return;

  // Neutral white/gray glow instead of a gold tint: white rays read as
  // a bright glow against the true-black dark background, and a soft
  // gray keeps the same effect visible (rather than vanishing) against
  // the true-white light background. Re-evaluated live off the theme
  // so it stays in sync if the theme is switched while this screen is open.
  const isDark = document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.hasAttribute("data-theme") &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const raysColor = isDark ? "#ffffff" : "#c9c9c9";

  destroyAuthRays = initLightRays(container, {
    raysOrigin: "top-center",
    raysColor,
    raysSpeed: 0.9,
    lightSpread: 0.65,
    rayLength: 1.4,
    fadeDistance: 1.1,
    saturation: 1.3,
    followMouse: true,
    mouseInfluence: 0.12,
    noiseAmount: 0.06,
    distortion: 0.04,
  });
}

export function restartAuthRays() {
  if (document.getElementById("authScreen")?.classList.contains("active")) {
    startAuthRays();
  }
}

let destroyHomeRays = null;

function startHomeRays() {
  if (destroyHomeRays) {
    destroyHomeRays();
    destroyHomeRays = null;
  }
  const container = document.getElementById("homeRays");
  if (!container) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // See startAuthRays() above for why this isn't a straight gold tint.
  const isDarkHome = document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.hasAttribute("data-theme") &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const homeRaysColor = isDarkHome ? "#ffffff" : "#c9c9c9";

  destroyHomeRays = initLightRays(container, {
    raysOrigin: "top-center",
    raysColor: homeRaysColor,
    raysSpeed: 0.9,
    lightSpread: 0.65,
    rayLength: 1.4,
    fadeDistance: 1.1,
    saturation: 1.3,
    followMouse: true,
    mouseInfluence: 0.12,
    noiseAmount: 0.06,
    distortion: 0.04,
  });
}

// Exposed so showView('homeView') can (re)start the rays each time home
// is shown, and setTheme() can re-tint them immediately on a theme
// switch - same pattern as restartAuthRays.
export function restartHomeRays() {
  if (document.getElementById("homeView")?.classList.contains("active")) {
    startHomeRays();
  }
}

export function stopHomeRays() {
  if (destroyHomeRays) {
    destroyHomeRays();
    destroyHomeRays = null;
  }
}

export function initAuthRaysIfMotionAllowed() {
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    startAuthRays();
  }
}
