/**
 * Centralized configuration system for Say So.
 * All user-configurable behavior is defined here, making it easy to customize
 * for different use cases (journaling, meeting notes, bug tracking, etc.)
 */

export const DEFAULT_CONFIG = {
  // Application metadata
  app: {
    name: process.env.APP_NAME || "Say So",
    description: process.env.APP_DESCRIPTION || "Capture and extract actionable insights from your work input",
  },

  // Capture settings: what kind of input this instance handles
  capture: {
    // Input methods to enable
    enableVoice: true,
    enableText: true,

    // What to capture
    inputLabel: "Your work update",
    inputPlaceholder: "Describe what you're working on, what happened, or what you need to do",
    successMessage: "Update captured. Extracting action points...",
  },

  // Extraction settings: what the model should look for in the input
  extraction: {
    // System prompt instructs the model on what to extract
    systemPrompt: `You are reading a personal work-update entry (voice or text). Extract only what the person actually said — never add advice, tips, or tasks they didn't mention.

Return JSON with four keys:

- actionPoints: array of short imperative phrases for concrete tasks implied by the entry ("Email Tayo about the invoice"). Empty array if nothing implies a task — never invent one.
- reflection: one short plain sentence acknowledging what was said, or null if it would add nothing beyond restating the entry.
- clarifyingQuestion: one short specific question, only if the entry implies a task but doesn't say what it is, or could mean two different things. Otherwise null. Ask about the single biggest ambiguity, never more than one question.
- memorableFacts: array of short standalone statements capturing durable facts about the person worth remembering in future entries — recurring people (names, roles, relationships), ongoing projects, stated goals, or clear preferences. Do NOT include one-off transient details (moods, single-day events, times, dates, anything true only today). Only include a fact if it would still be useful to know weeks from now. Empty array if nothing meets this bar — most entries will have none.

reflection and clarifyingQuestion are plain prose — no lists, no markdown, no meta-commentary about the entry itself, and never end with an offer to help further ("let me know if...", "want me to...").

Example — entry: "ugh long day, meetings back to back"
{"actionPoints": [], "reflection": "Sounds like a packed one.", "clarifyingQuestion": null, "memorableFacts": []}

Example — entry: "need to follow up with the vendor about that thing"
{"actionPoints": [], "reflection": null, "clarifyingQuestion": "What specifically do you need to follow up with the vendor about?", "memorableFacts": []}

Example — entry: "spent the afternoon debugging the payments migration with Priya again, she's been a huge help this sprint"
{"actionPoints": [], "reflection": "Good to have a strong collaborator on something this gnarly.", "clarifyingQuestion": null, "memorableFacts": ["Works with a colleague named Priya", "Working on a payments migration project"]}

Respond with raw JSON only — no markdown fences, no commentary.`,

    // Configuration for the action points themselves
    actionPoints: {
      label: "Action Points",
      prompt: "What specific tasks or actions are needed?",
      allowMultiple: true,
      allowCheck: true, // Can users mark them complete?
    },

    // Configuration for optional reflection
    reflection: {
      label: "Reflection",
      enabled: true,
      prompt: "What's the brief takeaway?",
    },

    // Configuration for clarifying questions
    clarifyingQuestion: {
      label: "Clarifying Question",
      enabled: true,
      prompt: "Is there anything unclear about the action points?",
    },
  },

  // UI/UX settings: how things appear to users
  ui: {
    theme: {
      primaryColor: "#F4D03F", // Gold
      accentColor: "#1A8E8E", // Teal
      backgroundColor: "#1a1a1a", // Dark charcoal
      textColor: "#ffffff",
    },

    layout: {
      maxWidth: "1000px",
      waveformHeight: 60,
      animationDuration: 300,
    },

    labels: {
      signIn: "Sign In",
      signUp: "Sign Up",
      logout: "Logout",
      myEntries: "My Entries",
      newEntry: "New Entry",
      startRecording: "Start Recording",
      stopRecording: "Stop Recording",
      submit: "Submit",
      cancel: "Cancel",
      loading: "Loading...",
      error: "Error",
      success: "Success",
    },
  },

  // Database schema configuration
  database: {
    // Table structure (users can extend this for custom fields)
    tables: {
      users: {
        columns: [
          { name: "id", type: "uuid", primaryKey: true },
          { name: "email", type: "text", unique: true, required: true },
          { name: "password_hash", type: "text", required: true },
          { name: "created_at", type: "timestamp", default: "now()" },
          { name: "updated_at", type: "timestamp", default: "now()" },
        ],
      },
      entries: {
        columns: [
          { name: "id", type: "uuid", primaryKey: true },
          { name: "user_id", type: "uuid", required: true, foreignKey: "users.id" },
          { name: "input_type", type: "text", enum: ["voice", "text"] },
          { name: "input_text", type: "text" },
          { name: "action_points", type: "jsonb", default: "[]" },
          { name: "reflection", type: "text" },
          { name: "clarifying_question", type: "text" },
          { name: "created_at", type: "timestamp", default: "now()" },
          { name: "updated_at", type: "timestamp", default: "now()" },
        ],
      },
      action_points: {
        columns: [
          { name: "id", type: "uuid", primaryKey: true },
          { name: "entry_id", type: "uuid", required: true, foreignKey: "entries.id" },
          { name: "text", type: "text", required: true },
          { name: "completed", type: "boolean", default: false },
          { name: "remind_at", type: "timestamp" },
          { name: "reminder_sent_at", type: "timestamp" },
          { name: "created_at", type: "timestamp", default: "now()" },
          { name: "updated_at", type: "timestamp", default: "now()" },
        ],
      },
    },
  },

  // AI model configuration
  ai: {
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    maxTokens: 1024,
    temperature: 0.7,
    retryAttempts: 3,
    retryDelayMs: 1000,
  },

  // Authentication settings
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    cookieName: "session",
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    passwordMinLength: 8,
  },

  // API endpoints configuration
  api: {
    basePath: "/api",
    endpoints: {
      auth: {
        signup: "/auth/signup",
        login: "/auth/login",
        logout: "/auth/logout",
        me: "/auth/me",
      },
      entries: {
        list: "/entries",
        create: "/entries",
        update: "/entries/:id",
        delete: "/entries/:id",
      },
      extract: {
        process: "/extract",
      },
    },
  },

  // Feature flags: easily enable/disable features
  features: {
    voiceInput: true,
    textInput: true,
    actionPointExtraction: true,
    reflectionExtraction: true,
    clarifyingQuestions: true,
    actionPointCompletion: true,
    entryEditing: true,
    entryDeletion: true,
  },

  // Logging and monitoring
  logging: {
    level: process.env.NODE_ENV === "production" ? "warn" : "debug",
    logRequests: true,
    logExtractions: true,
  },
};

/**
 * Validates that required environment variables are set
 */
export function validateConfig() {
  const required = ["DATABASE_URL", "JWT_SECRET", "GROQ_API_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

/**
 * Get a config value with optional default fallback
 */
export function getConfig(path, defaultValue = undefined) {
  const keys = path.split(".");
  let value = DEFAULT_CONFIG;

  for (const key of keys) {
    if (value && typeof value === "object" && key in value) {
      value = value[key];
    } else {
      return defaultValue;
    }
  }

  return value;
}

/**
 * Merge custom config with defaults
 */
export function mergeConfig(customConfig) {
  return deepMerge(DEFAULT_CONFIG, customConfig);
}

function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}
