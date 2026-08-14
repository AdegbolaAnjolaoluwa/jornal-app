// ===== Entry point =====
// Wires up every DOMContentLoaded event binding (previously the classic
// script's own top-level "===== Event Listeners =====" block), plus the
// light-rays kickoff and service worker registration that used to live in
// the trailing <script type="module"> tag.
//
// Module scripts (this one included) are deferred by default and always run
// before DOMContentLoaded fires, so registering the listener here behaves
// the same as the old classic <script>'s top-level listener did. This also
// retires the old two-script bridge: previously the classic script rendered
// the signup wizard's first step before `initCurvedInput` existed (it only
// became available once the trailing module script below it finished
// evaluating), so renderSignupWizardStep() had to be called a second time
// from that trailing script once initCurvedInput was ready. Now that
// initCurvedInput is a plain top-level import into auth.js (see
// ensureCurvedInputMounted there), it's available synchronously the first
// time renderSignupWizardStep() runs below - no second call needed.
import { state, CONFIG, SessionExpiredError } from "./state.js";
import { authFetch } from "./api.js";
import {
  showView,
  showAuthScreen,
  hideAuthSessionInterstitial,
  switchAuthTab,
  showAlert,
  clearForm,
  applySidebarCollapsed,
  toggleSidebarCollapsed,
  openSidebarDrawer,
  closeSidebarDrawer,
  isMobileViewport,
  renderThemeToggle,
  setTheme,
  showFirstEntryScreen,
  displayName,
  renderAvatar,
  blobToBase64,
  validateAuthForm,
  trackEvent,
  initAuthRaysIfMotionAllowed,
} from "./ui-shell.js";

import {
  handleSignin,
  handleForgotPassword,
  handleResetPassword,
  handleLogout,
  renderSignupWizardStep,
  advanceSignupWizard,
  retreatSignupWizard,
  resetSignupWizard,
  showAuthTabRespectingSession,
  checkAuth,
  enterApp,
  finishOnboarding,
  renderProfileSection,
} from "./auth.js";

import {
  submitEntry,
  startRecording,
  cancelRecording,
  togglePauseResume,
  finishRecording,
  autoGrowTextarea,
  bindComposerTagInput,
  closeRecordingPreview,
  reRecordFromPreview,
  deleteRecording,
  handleSendMode,
  setPreviewPlayIcon,
  formatTimer,
  initVoiceRecognition,
} from "./composer.js";

import { startNewChat, closeEntryDetail, renderEntries } from "./entries.js";

import { bindRecapPeriodToggle, bindAskForm } from "./ask-recap.js";

import { initServiceWorker } from "./sw-update.js";

document.addEventListener("DOMContentLoaded", () => {
  // Auth tab switcher (segmented control)
  document.querySelectorAll(".auth-tabs:not(#themeToggle) .auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      switchAuthTab(tab.dataset.tab);
      if (tab.dataset.tab === "signup") resetSignupWizard();
    });
  });

  // Theme toggle (segmented control)
  document.querySelectorAll("#themeToggle .auth-tab").forEach((btn) => {
    btn.addEventListener("click", () => setTheme(btn.dataset.themeValue));
  });

  // Auth switch links (bottom of form)
  document.querySelectorAll(".auth-switch a[data-switch-tab]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      switchAuthTab(link.dataset.switchTab);
      if (link.dataset.switchTab === "signup") resetSignupWizard();
    });
  });

  // Password visibility toggles
  document.querySelectorAll(".password-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      btn.textContent = isHidden ? "Hide" : "Show";
    });
  });

  // Auth forms: client-side validation on submit, then hit the API
  document.getElementById("signinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateAuthForm("signin")) return;
    const email = document.getElementById("signin-email").value;
    const password = document.getElementById("signin-password").value;
    const rememberMe = document.getElementById("signin-remember-me").checked;
    await handleSignin(email, password, rememberMe);
  });

  // Signup is now a step-by-step wizard (see "Signup Wizard" section
  // above) - Enter key submits via each curved-input's own onSubmit
  // (wired to advanceSignupWizard), not this form's submit event.
  document.getElementById("signupForm").addEventListener("submit", (e) => e.preventDefault());
  document.getElementById("signupWizardContinueBtn").addEventListener("click", advanceSignupWizard);
  document.getElementById("signupWizardBackBtn").addEventListener("click", retreatSignupWizard);
  renderSignupWizardStep();

  document.getElementById("forgotForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleForgotPassword(document.getElementById("forgot-email").value.trim());
  });

  document.getElementById("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleResetPassword(document.getElementById("reset-password").value);
  });

  // Composer: mic + recording controls
  document.getElementById("micBtn").addEventListener("click", startRecording);
  document.getElementById("cancelRecordBtn").addEventListener("click", cancelRecording);
  document.getElementById("pauseResumeBtn").addEventListener("click", togglePauseResume);
  document.getElementById("finishRecordBtn").addEventListener("click", finishRecording);
  document.getElementById("textInput").addEventListener("input", (e) => {
    autoGrowTextarea();
    const hasText = !!e.target.value.trim();
    document.getElementById("submitBtn").disabled = !hasText;
    document.getElementById("composer").classList.toggle("has-text", hasText);
  });
  document.getElementById("textInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && state.currentInputType === "text" && state.composerMode === "idle") {
      e.preventDefault();
      submitEntry();
    }
  });

  // Composer tag input
  bindComposerTagInput();

  // Recap period toggle (Week/Month) - static markup, bound once
  bindRecapPeriodToggle();

  // Ask form - static markup, bound once
  bindAskForm();

  // Form actions (plain-text path)
  document.getElementById("submitBtn").addEventListener("click", () => submitEntry());
  document.getElementById("cancelBtn").addEventListener("click", clearForm);
  document.getElementById("tempChatBtn").addEventListener("click", () => {
    state.isTemporaryMode = !state.isTemporaryMode;
    const btn = document.getElementById("tempChatBtn");
    btn.classList.toggle("active", state.isTemporaryMode);
    btn.setAttribute("aria-pressed", String(state.isTemporaryMode));
    btn.title = state.isTemporaryMode ? "Temporary chat (on), entries won't be saved" : "Temporary chat";
  });
  document.getElementById("clearTempBtn").addEventListener("click", () => {
    state.entries = state.entries.filter((e) => !e.isTemporary);
    renderEntries();
  });

  // Recording preview overlay
  document.getElementById("previewCloseBtn").addEventListener("click", closeRecordingPreview);
  document.getElementById("recordingPreviewOverlay").addEventListener("click", (e) => {
    if (e.target.id === "recordingPreviewOverlay") closeRecordingPreview();
  });
  document.getElementById("previewReRecordBtn").addEventListener("click", reRecordFromPreview);
  document.getElementById("previewDeleteBtn").addEventListener("click", deleteRecording);
  document.querySelectorAll(".send-option-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleSendMode(btn.dataset.mode));
  });

  const previewAudio = document.getElementById("previewAudio");
  const previewScrubber = document.getElementById("previewScrubber");
  document.getElementById("previewPlayBtn").addEventListener("click", () => {
    if (previewAudio.paused) previewAudio.play();
    else previewAudio.pause();
  });
  previewAudio.addEventListener("play", () => setPreviewPlayIcon(true));
  previewAudio.addEventListener("pause", () => setPreviewPlayIcon(false));
  previewAudio.addEventListener("ended", () => setPreviewPlayIcon(false));
  previewAudio.addEventListener("timeupdate", () => {
    if (!previewAudio.duration) return;
    previewScrubber.value = (previewAudio.currentTime / previewAudio.duration) * 100;
    document.getElementById("previewTime").textContent =
      `${formatTimer(previewAudio.currentTime * 1000)} / ${formatTimer(previewAudio.duration * 1000)}`;
  });
  previewScrubber.addEventListener("input", () => {
    if (!previewAudio.duration) return;
    previewAudio.currentTime = (previewScrubber.value / 100) * previewAudio.duration;
  });

  // Logout
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);

  // "Already signed in" interstitial (shown for explicit ?tab=signin/signup
  // navigation when a session already exists - see showAuthTabRespectingSession)
  document.getElementById("authSessionLogoutBtn").addEventListener("click", async () => {
    await handleLogout();
    hideAuthSessionInterstitial();
    const requestedTab = new URLSearchParams(window.location.search).get("tab") || "signup";
    switchAuthTab(requestedTab);
  });
  document.getElementById("authSessionContinueBtn").addEventListener("click", () => {
    hideAuthSessionInterstitial();
    enterApp();
  });

  // New Entry button and brand/logo both start a fresh "new chat":
  // return to the home view, closing the mobile drawer if it was open.
  document.getElementById("newEntryBtn").addEventListener("click", () => startNewChat({ focusInput: true }));
  document.getElementById("sidebarBrand").addEventListener("click", () => startNewChat());
  document.getElementById("sidebarBrand").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      startNewChat();
    }
  });

  // Sidebar collapse (desktop) / drawer (mobile)
  applySidebarCollapsed(state.sidebarCollapsed);
  document.getElementById("sidebarCollapseBtn").addEventListener("click", () => {
    if (isMobileViewport()) {
      closeSidebarDrawer();
    } else {
      toggleSidebarCollapsed();
    }
  });
  // hamburgerBtn is only ever visible while the sidebar is hidden (see
  // body.sidebar-hidden), so it only ever needs to open it back up -
  // on mobile that's the drawer, on desktop it's un-collapsing.
  document.getElementById("hamburgerBtn").addEventListener("click", () => {
    if (isMobileViewport()) {
      openSidebarDrawer();
    } else {
      toggleSidebarCollapsed();
    }
  });
  document.getElementById("sidebarBackdrop").addEventListener("click", closeSidebarDrawer);

  // Guide screen -> guided first entry
  document.getElementById("guideStartBtn").addEventListener("click", () => {
    showFirstEntryScreen();
  });

  // First entry screen
  document.getElementById("firstEntrySubmitBtn").addEventListener("click", async () => {
    const text = document.getElementById("firstEntryInput").value.trim();
    if (!text) {
      showAlert("Write a line or two to get started", "error");
      return;
    }
    await finishOnboarding();
    trackEvent("onboarding_first_entry_created");
    submitEntry("text", text);
  });

  document.getElementById("firstEntrySkipLink").addEventListener("click", async (e) => {
    e.preventDefault();
    await finishOnboarding();
    trackEvent("onboarding_first_entry_skipped");
  });

  // Conversation view: Back button, or Escape while it's open
  document.getElementById("conversationBackBtn").addEventListener("click", closeEntryDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.getElementById("conversationView").classList.contains("active")) {
        closeEntryDetail();
      }
      closeSidebarDrawer();
      if (state.composerMode === "previewing") closeRecordingPreview();
    }
  });

  // Sidebar navigation (also closes the mobile drawer on click)
  document.querySelectorAll(".sidebar-link[data-view]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showView(link.dataset.view);
      if (isMobileViewport()) closeSidebarDrawer();
    });
  });

  // Save Profile
  document.getElementById("saveProfileBtn").addEventListener("click", async () => {
    const nickname = document.getElementById("profileNicknameInput").value;
    try {
      const response = await authFetch(CONFIG.api.endpoints.profile, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || "Failed to save profile");
      }
      state.user.nickname = data.data.user.nickname;
      document.getElementById("userEmail").textContent = displayName(state.user);
      renderAvatar(
        document.getElementById("headerAvatar"),
        document.getElementById("headerAvatarPlaceholder"),
        state.user
      );
      renderProfileSection();
      showAlert("Profile saved", "success");
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showAlert(`Failed to save profile: ${error.message}`, "error");
      }
    }
  });

  // Export data as JSON
  document.getElementById("exportDataBtn").addEventListener("click", async () => {
    const btn = document.getElementById("exportDataBtn");
    btn.disabled = true;
    btn.textContent = "Exporting…";
    try {
      const response = await authFetch(CONFIG.api.endpoints.export);
      if (!response.ok) throw new Error("Failed to export entries");
      const data = await response.json();
      const json = JSON.stringify(data.data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `say-so-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      showAlert("Export downloaded", "success");
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showAlert(`Failed to export: ${error.message}`, "error");
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "Export as JSON";
    }
  });

  // Delete account: type-to-confirm modal, not a plain confirm() -
  // this cascades every entry/fact/tag/recap and can't be undone, so
  // it gets a stronger confirmation than the single-entry delete does.
  const DELETE_ACCOUNT_CONFIRM_PHRASE = "delete my account";
  function updateDeleteAccountBtnState() {
    const phraseOk =
      document.getElementById("deleteAccountConfirmInput").value.trim().toLowerCase() ===
      DELETE_ACCOUNT_CONFIRM_PHRASE;
    const passwordOk = document.getElementById("deleteAccountPasswordInput").value.length > 0;
    document.getElementById("deleteAccountConfirmBtn").disabled = !(phraseOk && passwordOk);
  }

  document.getElementById("deleteAccountBtn").addEventListener("click", () => {
    document.getElementById("deleteAccountConfirmInput").value = "";
    document.getElementById("deleteAccountPasswordInput").value = "";
    document.getElementById("deleteAccountConfirmBtn").disabled = true;
    document.getElementById("deleteAccountError").textContent = "";
    document.getElementById("deleteAccountOverlay").classList.add("active");
    document.getElementById("deleteAccountConfirmInput").focus();
  });

  function closeDeleteAccountModal() {
    document.getElementById("deleteAccountOverlay").classList.remove("active");
  }

  document.getElementById("deleteAccountCloseBtn").addEventListener("click", closeDeleteAccountModal);
  document.getElementById("deleteAccountCancelBtn").addEventListener("click", closeDeleteAccountModal);
  document.getElementById("deleteAccountOverlay").addEventListener("click", (e) => {
    if (e.target.id === "deleteAccountOverlay") closeDeleteAccountModal();
  });

  document.getElementById("deleteAccountConfirmInput").addEventListener("input", updateDeleteAccountBtnState);
  document.getElementById("deleteAccountPasswordInput").addEventListener("input", updateDeleteAccountBtnState);

  document.getElementById("deleteAccountConfirmBtn").addEventListener("click", async () => {
    const btn = document.getElementById("deleteAccountConfirmBtn");
    const errorEl = document.getElementById("deleteAccountError");
    const password = document.getElementById("deleteAccountPasswordInput").value;
    btn.disabled = true;
    btn.textContent = "Deleting…";
    errorEl.textContent = "";
    try {
      const response = await authFetch(CONFIG.api.endpoints.deleteAccount, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || "Failed to delete account");
      }
      closeDeleteAccountModal();
      await handleLogout();
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        errorEl.textContent = error.message;
        btn.disabled = false;
        btn.textContent = "Delete my account";
      }
    }
  });

  // Profile picture upload
  document.getElementById("profilePictureInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const previewImg = document.getElementById("profilePicturePreview");
    const previewPlaceholder = document.getElementById("profilePicturePlaceholder");
    const previousSrc = previewImg.src;
    const previousDisplay = previewImg.style.display;

    const objectUrl = URL.createObjectURL(file);
    previewImg.src = objectUrl;
    previewImg.style.display = "";
    previewPlaceholder.style.display = "none";

    try {
      const imageBase64 = await blobToBase64(file);
      const response = await authFetch(CONFIG.api.endpoints.picture, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType: file.type }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || "Failed to upload picture");
      }

      // Re-fetch to get the canonical data URI from the server
      const meResponse = await authFetch(CONFIG.api.endpoints.me);
      const meData = await meResponse.json();
      state.user.profilePictureDataUri = meData.data.user.profilePictureDataUri;

      renderAvatar(
        document.getElementById("headerAvatar"),
        document.getElementById("headerAvatarPlaceholder"),
        state.user
      );
      renderProfileSection();
      showAlert("Profile picture updated", "success");
    } catch (error) {
      previewImg.src = previousSrc;
      previewImg.style.display = previousDisplay;
      renderProfileSection();
      if (!(error instanceof SessionExpiredError)) {
        showAlert(`Failed to upload picture: ${error.message}`, "error");
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
      e.target.value = "";
    }
  });

  // Initialize
  initVoiceRecognition();
  // The <head> script already applied the saved/OS theme before first
  // paint (avoiding a flash) - this just syncs the Settings toggle's
  // active-button highlight to match, so it's not showing a stale
  // selection if you open Settings without having visited it this load.
  renderThemeToggle();
  const initialParams = new URLSearchParams(window.location.search);
  const requestedTab = initialParams.get("tab");
  if (initialParams.has("resetToken")) {
    switchAuthTab("reset");
    showAuthScreen();
  } else if (requestedTab === "signin" || requestedTab === "signup") {
    // Explicit navigation to the auth form: don't silently restore an
    // existing session into this navigation, but don't hide that a
    // session exists either - checkAuth() below is for the bare "/app"
    // case where restoring the session IS the intended behavior.
    showAuthTabRespectingSession(requestedTab);
  } else {
    checkAuth();
  }
});

initServiceWorker();
initAuthRaysIfMotionAllowed();
