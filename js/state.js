// ===== Configuration & State =====
// Single source of truth for CONFIG and state, imported (never reassigned -
// only mutated in place) by every other module.

export const CONFIG = {
  api: {
    baseUrl: "/api",
    endpoints: {
      signup: "/api/auth/signup",
      login: "/api/auth/login",
      logout: "/api/auth/logout",
      me: "/api/auth/me",
      profile: "/api/auth/profile",
      picture: "/api/auth/picture",
      deleteAccount: "/api/auth/delete-account",
      requestPasswordReset: "/api/auth/password-reset",
      resetPassword: "/api/auth/password-reset",
      entries: "/api/entries",
      extract: "/api/extract",
      facts: "/api/facts",
      actionPoints: "/api/action-points",
      tags: "/api/tags",
      export: "/api/export",
      recap: "/api/recap",
      ask: "/api/ask",
      chat: "/api/chat",
    },
  },
  voice: {
    continuous: true,
    interimResults: true,
    language: "en-US",
  },
};

// Audio is uploaded base64-encoded (~33% overhead), so the raw-audio ceiling
// is lower than the underlying ~4.5MB Vercel request body limit.
export const MAX_AUDIO_UPLOAD_BYTES = 3.2 * 1024 * 1024;

export const state = {
  user: null,
  isOfflineProvisional: false,
  entries: [],
  currentInputType: "text",
  facts: [],
  todoActionPoints: [],
  recapPeriod: "week",
  isTemporaryMode: false,
  conversationReturnView: "homeView",
  sidebarCollapsed: (typeof localStorage !== "undefined" && localStorage.getItem("sayso_sidebar_collapsed") === "1") || false,
  sidebarMobileOpen: false,

  tags: [],
  composerTags: [],
  tagFilter: null, // { id, name } | null - filters the sidebar history list

  composerMode: "idle", // idle | recording | paused | previewing
  mediaRecorder: null,
  mediaStream: null,
  audioChunks: [],
  audioBlob: null,
  audioObjectUrl: null,
  audioTooLarge: false,
  audioContext: null,
  analyserNode: null,
  waveformRafId: null,
  cancelled: false,

  recordingStartedAt: null,
  pausedElapsedMs: 0,
  timerIntervalId: null,

  recognitionActive: false,
  finalTranscript: "",
  interimTranscript: "",
  transcriptPrefix: "",

  textBeforeRecording: "",
};

// Marks an error as "already handled" (session-expiry redirect already shown)
// so callers' catch blocks can skip showing their own generic error toast.
export class SessionExpiredError extends Error {}
