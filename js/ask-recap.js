// ===== Ask & Recap =====
import { CONFIG, state, SessionExpiredError } from "./state.js";
import { authFetch } from "./api.js";
import { escapeHtml, localDateString } from "./ui-shell.js";
import { chatMessageHtml } from "./chat.js";

// ===== Ask =====
// Loading an already-open Ask view (e.g. navigating back to it) just
// clears the input - the last answer, if any, stays visible until a
// new question is actually submitted. Each question replaces the
// previously shown answer rather than accumulating a list, since
// retrieval/grounding is independent per question.
export function loadAskView() {
  const input = document.getElementById("askInput");
  if (input) input.value = "";
}

export async function submitAskQuestion(question) {
  const content = document.getElementById("askContent");
  const input = document.getElementById("askInput");
  const submitBtn = document.querySelector("#askForm .chat-send-btn");

  if (content) {
    content.innerHTML =
      '<div class="recap-loading">Thinking <span class="thinking-dots"><span></span><span></span><span></span></span></div>';
  }
  if (input) input.disabled = true;
  if (submitBtn) submitBtn.disabled = true;

  try {
    const response = await authFetch(CONFIG.api.endpoints.ask, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error?.message || "Failed to get an answer");
    }
    const data = await response.json();
    renderAskAnswer(question, data.data.answer);
    if (input) input.value = "";
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      if (content) {
        content.innerHTML = `<div class="empty-state"><h3>Couldn't get an answer</h3><p>${escapeHtml(error.message)}</p></div>`;
      }
    }
  } finally {
    if (input) input.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Matches api/ask.js's NOTHING_FOUND_ANSWER exactly - when the backend's
// hard-coded empty-retrieval string comes back, add a next-step
// suggestion in the UI rather than leaving the user at a dead end.
// Kept as a separate frontend-only line (not baked into the API
// string) so this is pure UI copy, not an API contract change.
const ASK_NOTHING_FOUND_ANSWER = "I don't see anything in your journal about that yet.";

function renderAskAnswer(question, answer) {
  const content = document.getElementById("askContent");
  if (!content) return;
  const nudge =
    answer === ASK_NOTHING_FOUND_ANSWER
      ? '<div class="ask-nudge">Try different words, or ask about a specific person, project, or date.</div>'
      : "";
  content.innerHTML = `
    <div class="chat-thread">
      <div class="chat-messages">
        ${chatMessageHtml("user", question)}
        ${chatMessageHtml("assistant", answer)}
      </div>
      ${nudge}
    </div>
  `;
}

export function bindAskForm() {
  const form = document.getElementById("askForm");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("askInput");
    const question = input?.value.trim();
    if (!question) return;
    submitAskQuestion(question);
  });

  // Delegated so it still works after askContent gets re-rendered
  // with an answer/error (the example chips only exist pre-submit).
  const content = document.getElementById("askContent");
  if (content) {
    content.addEventListener("click", (e) => {
      const chip = e.target.closest(".ask-example-chip");
      if (!chip) return;
      submitAskQuestion(chip.textContent.trim());
    });
  }
}

// ===== Recap =====
export async function loadRecap() {
  const content = document.getElementById("recapContent");
  if (content) content.innerHTML = '<div class="recap-loading">Building your recap…</div>';

  document.querySelectorAll(".recap-period-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.period === state.recapPeriod);
  });

  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const params = new URLSearchParams({ periodType: state.recapPeriod, timezone, today: localDateString() });
    const response = await authFetch(`${CONFIG.api.endpoints.recap}?${params}`);
    if (!response.ok) throw new Error("Failed to load recap");
    const data = await response.json();
    renderRecap(data.data);
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      if (content) {
        content.innerHTML = `<div class="empty-state"><h3>Couldn't load recap</h3><p>${escapeHtml(error.message)}</p></div>`;
      }
    }
  }
}

function renderRecap(recap) {
  const content = document.getElementById("recapContent");
  if (!content) return;

  if (recap.stats.entryCount === 0) {
    const periodWord = recap.periodType === "week" ? "week" : "month";
    content.innerHTML = `<div class="empty-state"><h3>Nothing yet</h3><p>Write a few entries this ${periodWord} and your recap will show up here.</p></div>`;
    return;
  }

  const tagsHtml = recap.stats.topTags.length
    ? `<div class="recap-tags-row">${recap.stats.topTags.map((t) => `<span class="recap-tag-chip">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";

  content.innerHTML = `
    <div class="recap-card">
      <div class="recap-stats-row">
        <div class="recap-stat">
          <span class="recap-stat-value">${recap.stats.entryCount}</span>
          <span class="recap-stat-label">${recap.stats.entryCount === 1 ? "Entry" : "Entries"}</span>
        </div>
        <div class="recap-stat">
          <span class="recap-stat-value">${recap.stats.completedCount}</span>
          <span class="recap-stat-label">Completed</span>
        </div>
      </div>
      ${tagsHtml}
      <div class="recap-summary">${escapeHtml(recap.summary || "")}</div>
    </div>
  `;
}

export function bindRecapPeriodToggle() {
  document.querySelectorAll(".recap-period-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.period === state.recapPeriod) return;
      state.recapPeriod = btn.dataset.period;
      loadRecap();
    });
  });
}
