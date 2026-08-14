// ===== Entries =====
// Entry list/detail rendering, tags on entries, editing entry text,
// re-extraction.
import { CONFIG, state, SessionExpiredError } from "./state.js";
import { authFetch, isOfflineError } from "./api.js";
import { showAlert, escapeHtml, truncate, debounce, localDateString, showView, isMobileViewport, closeSidebarDrawer, clearForm } from "./ui-shell.js";
import {
  badgeHtml,
  actionPointsHtml,
  dueDateLabelHtml,
  bindActionPointHandlers,
} from "./action-points.js";
import { chatThreadHtml, loadChatThread, sendChatMessage } from "./chat.js";

// ===== Entry Functions =====
// Read-only offline fallback cache for the unfiltered entries list, so
// a dropped connection shows your last-known journal instead of an
// error screen. Deliberately one-directional (write on success, read
// only when a live fetch fails) - there's no sync/merge logic here,
// just "show what we last saw" while offline.
function entriesCacheKey() {
  return state.user?.id ? `sayso_entries_cache_${state.user.id}` : null;
}

function cacheEntries(entries) {
  const key = entriesCacheKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ entries, cachedAt: new Date().toISOString() }));
  } catch (e) {
    // Storage full or unavailable (private browsing, etc.) - offline
    // reading just won't be available this session, nothing to recover.
  }
}

function readCachedEntries() {
  const key = entriesCacheKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Bumped on every loadEntries() call so an in-flight request that resolves
// after a newer one (e.g. rapid search typing) can detect it's stale and
// discard its result instead of clobbering more recent entries.
let entriesRequestSeq = 0;

export async function loadEntries() {
  const requestId = ++entriesRequestSeq;
  try {
    const url = state.tagFilter
      ? `${CONFIG.api.endpoints.entries}?tag=${encodeURIComponent(state.tagFilter.id)}`
      : CONFIG.api.endpoints.entries;
    const response = await authFetch(url);

    if (!response.ok) throw new Error("Failed to load entries");

    const data = await response.json();
    if (requestId !== entriesRequestSeq) return; // a newer request already superseded this one

    const tempEntries = state.entries.filter((e) => e.isTemporary);
    state.entries = [...tempEntries, ...data.data.entries];
    renderEntries();
    // Only cache the unfiltered result - caching a filtered subset
    // would make a later offline, filter-free load look like the
    // journal only has those few entries.
    if (!state.tagFilter) cacheEntries(data.data.entries);
  } catch (error) {
    if (requestId !== entriesRequestSeq) return;
    if (!(error instanceof SessionExpiredError)) {
      if (isOfflineError(error) && !state.tagFilter) {
        const cached = readCachedEntries();
        if (cached) {
          const tempEntries = state.entries.filter((e) => e.isTemporary);
          state.entries = [...tempEntries, ...cached.entries];
          renderEntries();
          showAlert(
            `You're offline, showing your journal as of ${new Date(cached.cachedAt).toLocaleString()}.`,
            "info"
          );
          return;
        }
      }
      showAlert(`Failed to load entries: ${error.message}`, "error");
    }
  }
}

function groupEntriesByDate(entries) {
  const groups = [];
  let currentGroupKey = null;
  for (const entry of entries) {
    const date = new Date(entry.created_at);
    const groupKey = date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    if (groupKey !== currentGroupKey) {
      groups.push({ label: groupKey, entries: [] });
      currentGroupKey = groupKey;
    }
    groups[groups.length - 1].entries.push(entry);
  }
  return groups;
}

// Converts groupEntriesByDate's literal weekday+date label into a
// relative one ("Today"/"Yesterday"/"Last week") for the sidebar
// history list, where a relative label reads more naturally at a
// glance than an absolute date.
function toSemanticLabel(literalLabel, sampleDateIso) {
  const entryDate = new Date(sampleDateIso);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOfDay(new Date());
  const entryDay = startOfDay(entryDate);
  const diffDays = Math.round((today - entryDay) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays <= 7) return "Last week";
  return literalLabel;
}

function groupEntriesByDateSemantic(entries) {
  return groupEntriesByDate(entries).map((group) => ({
    ...group,
    label: toSemanticLabel(group.label, group.entries[0].created_at),
  }));
}

function updateClearTempButton() {
  const hasTemp = state.entries.some((e) => e.isTemporary);
  document.getElementById("clearTempBtn").style.display = hasTemp ? "" : "none";
}

// Renders the sidebar's recent-history list and the To-do List open-count
// badge from whatever state.entries currently holds - there's no
// dedicated "browse all entries" page, so this is the only place
// state.entries gets painted into the UI.
export function renderEntries() {
  updateClearTempButton();
  renderSidebarHistory();
  renderSidebarOpenCount();
}

// Sidebar history: a lightweight snippet list, deliberately NOT reusing
// renderEntryCard (that's sized/styled for the ~720px main feed column
// with full action-points/reflection/tags - at 264px sidebar width it
// would need parallel CSS overrides for every sub-block). Reflects
// whatever state.entries currently holds, so it's scoped to the same
// ~50-most-recent-matching-the-active-search-or-filter window as the
// main feed, not a separate/unfiltered full history.
export function renderSidebarHistory() {
  const container = document.getElementById("sidebarHistoryList");
  if (!container) return;

  const filterHtml = state.tagFilter
    ? `
    <div class="sidebar-tag-filter">
      <span>Filtered by: <strong>${escapeHtml(state.tagFilter.name)}</strong></span>
      <button type="button" id="clearTagFilterBtn" aria-label="Clear tag filter">&times;</button>
    </div>
  `
    : "";

  if (state.entries.length === 0) {
    const emptyMessage = state.tagFilter
      ? `No entries tagged "${escapeHtml(state.tagFilter.name)}"`
      : "No entries yet";
    container.innerHTML = `${filterHtml}<div class="sidebar-history-group-label">${emptyMessage}</div>`;
    bindClearTagFilter(container);
    return;
  }
  const groups = groupEntriesByDateSemantic(state.entries);
  container.innerHTML =
    filterHtml +
    groups
      .map(
        (group) => `
    <div class="sidebar-history-group-label">${escapeHtml(group.label)}</div>
    ${group.entries
      .map((entry) => {
        const date = new Date(entry.created_at);
        const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        // Entries created before the AI-title feature (or still mid-extraction)
        // have no title yet - fall back to a truncated snippet of the raw text.
        const snippet = entry.title || truncate(entry.input_text, 42);
        return `
        <div class="sidebar-history-item" data-entry-id="${entry.id}">
          <div class="sidebar-history-item-text">${escapeHtml(snippet)}</div>
          <div class="sidebar-history-item-time">${timeStr}</div>
        </div>
      `;
      })
      .join("")}
  `
      )
      .join("");
  bindClearTagFilter(container);
  container.querySelectorAll(".sidebar-history-item").forEach((item) => {
    item.addEventListener("click", () => {
      // The history list is visible from every view, so "wherever I
      // clicked from" isn't meaningful context to return to (e.g.
      // Settings) - always send Back/Escape home instead.
      openEntryDetail(item.dataset.entryId, { returnView: "homeView" });
      closeSidebarDrawer();
    });
  });
  bindSidebarHistoryDelete(container);
}

// Permanently deletes an entry and everything tied to it (reminders,
// action points, chat thread, memorable facts - all cascade at the DB
// level from a single DELETE). This is the only removal path in the
// app - reachable via long-press (mobile) or right-click (desktop) on
// a sidebar history item.
export async function deleteEntryPermanently(entryId) {
  if (!confirm("Permanently delete this entry? This also deletes its reminders, action points, and any facts learned from it. This cannot be undone.")) {
    return;
  }
  try {
    const response = await authFetch(`${CONFIG.api.endpoints.entries}/${entryId}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Request failed");

    state.entries = state.entries.filter((e) => e.id !== entryId);
    renderEntries();

    // If the deleted entry's detail happens to be open, sending the
    // user home is less jarring than leaving a detail view pointed at
    // an id that no longer exists.
    if (document.querySelector(`#conversationDetail[data-entry-id="${entryId}"]`)) {
      showView("homeView");
    }

    showAlert("Entry deleted", "success");
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      showAlert(`Failed to delete entry: ${error.message}`, "error");
    }
  }
}

function bindClearTagFilter(container) {
  const btn = container.querySelector("#clearTagFilterBtn");
  if (btn) btn.addEventListener("click", clearTagFilter);
}

export function applyTagFilter(tagId, tagName) {
  state.tagFilter = { id: tagId, name: tagName };
  loadEntries();
}

export function clearTagFilter() {
  state.tagFilter = null;
  loadEntries();
}

// Right-click (desktop) or long-press (~500ms, mobile/touch) on a
// sidebar history item deletes it, after confirmation. Long-press is
// cancelled if the finger moves more than a few pixels (a scroll, not
// a press-and-hold) or lifts early, so it doesn't fight normal list
// scrolling or a quick tap-to-open.
function bindSidebarHistoryDelete(container) {
  const LONG_PRESS_MS = 500;
  const MOVE_CANCEL_PX = 10;

  container.querySelectorAll(".sidebar-history-item").forEach((item) => {
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      deleteEntryPermanently(item.dataset.entryId);
    });

    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let longPressFired = false;

    const clearPress = () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
      item.classList.remove("pending-delete");
    };

    item.addEventListener(
      "touchstart",
      (e) => {
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        longPressFired = false;
        clearPress();
        item.classList.add("pending-delete");
        pressTimer = setTimeout(() => {
          longPressFired = true;
          item.classList.remove("pending-delete");
          if (navigator.vibrate) navigator.vibrate(15);
          deleteEntryPermanently(item.dataset.entryId);
        }, LONG_PRESS_MS);
      },
      { passive: true }
    );

    item.addEventListener(
      "touchmove",
      (e) => {
        const touch = e.touches[0];
        if (
          Math.abs(touch.clientX - startX) > MOVE_CANCEL_PX ||
          Math.abs(touch.clientY - startY) > MOVE_CANCEL_PX
        ) {
          clearPress();
        }
      },
      { passive: true }
    );

    item.addEventListener("touchend", clearPress);
    item.addEventListener("touchcancel", clearPress);

    // A long-press that fired the delete confirmation shouldn't also
    // register as the tap-to-open click that follows the touch sequence.
    item.addEventListener(
      "click",
      (e) => {
        if (longPressFired) {
          e.stopPropagation();
          e.preventDefault();
          longPressFired = false;
        }
      },
      true
    );
  });
}

// Derived from state.entries's already-attached action_points (not a
// dedicated state.todoActionPoints fetch, which is empty until the
// To-do view has been visited). This means the count reflects open
// action points among the currently-loaded ~50 most recent entries,
// not a true lifetime total - an honest limitation given there's no
// "count everything" endpoint today.
function computeOpenActionPointCount() {
  return state.entries
    .filter((e) => !e.isTemporary)
    .reduce((sum, e) => sum + (e.action_points || []).filter((ap) => !ap.completed).length, 0);
}

function renderSidebarOpenCount() {
  const el = document.getElementById("todoOpenCountBadge");
  if (!el) return;
  const count = computeOpenActionPointCount();
  el.textContent = String(count);
  el.style.display = count === 0 ? "none" : "";
}

function tempActionPointsHtml(actionPoints) {
  if (!actionPoints || actionPoints.length === 0) return "";
  return `
    <div class="action-points">
      <div class="action-points-label">Action Points &middot; ${actionPoints.length}</div>
      ${actionPoints
        .map((ap) => {
          // extraction.actionPoints is [{text, dueDate}] objects, but
          // tolerate a plain string too in case a caller predates that shape.
          const text = typeof ap === "string" ? ap : ap.text;
          const dueDate = typeof ap === "string" ? null : ap.dueDate;
          return `
        <div class="action-point action-point--readonly">
          <div class="action-point-box"></div>
          <div class="action-point-text">${escapeHtml(text)}</div>
          ${dueDateLabelHtml(dueDate, false)}
        </div>
      `;
        })
        .join("")}
    </div>
  `;
}

function reflectionHtml(reflection) {
  if (!reflection) return "";
  return `
    <div class="reflection">
      <div class="reflection-label">Reflection</div>
      <p>${escapeHtml(reflection)}</p>
    </div>
  `;
}

// Stands in for the action points/reflection sections while extraction
// is running, in place of a toast - pulsing dots plus shimmering
// skeleton bars, filled in with the real content once it arrives.
function extractionThinkingHtml() {
  return `
    <div class="extraction-thinking">
      <span class="thinking-dots"><span></span><span></span><span></span></span>
      <div class="skeleton-bar skeleton-bar--medium"></div>
      <div class="skeleton-bar skeleton-bar--full"></div>
      <div class="skeleton-bar skeleton-bar--short"></div>
    </div>
  `;
}

// ===== Entry Detail =====
function detailTagEditorHtml(entryTags) {
  return `
    <div class="detail-section">
      <div class="composer-tags" id="detailTagsRow">
        <div class="tag-chip-list" id="detailTagChips">
          ${entryTags
            .map(
              (t) => `
            <span class="tag-chip" data-tag-id="${t.id}">
              <button type="button" class="tag-chip-filter" data-tag-id="${t.id}" data-tag-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>
              <button type="button" class="tag-chip-remove" data-tag-id="${t.id}" aria-label="Remove tag">&times;</button>
            </span>
          `
            )
            .join("")}
        </div>
        <input type="text" id="detailTagInput" class="tag-input" placeholder="Add tag…" autocomplete="off" />
        <div class="tag-autocomplete-list" id="detailTagAutocomplete"></div>
      </div>
    </div>
  `;
}

async function saveEntryTags(entryId, tagNames) {
  const response = await authFetch(`${CONFIG.api.endpoints.entries}/${entryId}/tags`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: tagNames }),
  });
  if (!response.ok) throw new Error("Failed to update tags");
  const data = await response.json();
  return data.data.tags;
}

function bindDetailTagEditor(card, entryId) {
  const input = card.querySelector("#detailTagInput");
  const chipsContainer = card.querySelector("#detailTagChips");
  const autocompleteList = card.querySelector("#detailTagAutocomplete");
  if (!input || !chipsContainer) return;

  async function applyTagChange(newTagNames) {
    try {
      const updatedTags = await saveEntryTags(entryId, newTagNames);
      const entry = state.entries.find((e) => e.id === entryId);
      if (entry) entry.tags = updatedTags;
      chipsContainer.innerHTML = updatedTags
        .map(
          (t) => `
        <span class="tag-chip" data-tag-id="${t.id}">
          <button type="button" class="tag-chip-filter" data-tag-id="${t.id}" data-tag-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>
          <button type="button" class="tag-chip-remove" data-tag-id="${t.id}" aria-label="Remove tag">&times;</button>
        </span>
      `
        )
        .join("");
      bindRemoveButtons();
      bindFilterButtons();
      renderEntries();
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showAlert(`Failed to update tags: ${error.message}`, "error");
      }
    }
  }

  function currentTagNames() {
    const entry = state.entries.find((e) => e.id === entryId);
    return (entry?.tags || []).map((t) => t.name);
  }

  function bindRemoveButtons() {
    chipsContainer.querySelectorAll(".tag-chip-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const entry = state.entries.find((ent) => ent.id === entryId);
        const remaining = (entry?.tags || []).filter((t) => t.id !== btn.dataset.tagId).map((t) => t.name);
        applyTagChange(remaining);
      });
    });
  }

  // Clicking a tag's name (not the x) filters the sidebar history to
  // just entries with that tag, and closes the detail view so the
  // filtered list is immediately visible.
  function bindFilterButtons() {
    chipsContainer.querySelectorAll(".tag-chip-filter").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        applyTagFilter(btn.dataset.tagId, btn.dataset.tagName);
        closeEntryDetail();
      });
    });
  }

  bindRemoveButtons();
  bindFilterButtons();

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const trimmed = input.value.trim();
      if (!trimmed) return;
      const names = currentTagNames();
      if (names.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
        input.value = "";
        return;
      }
      applyTagChange([...names, trimmed]);
      input.value = "";
      if (autocompleteList) autocompleteList.classList.remove("visible");
    }
  });

  if (autocompleteList) {
    const showSuggestions = debounce(async (prefix) => {
      if (!prefix) {
        autocompleteList.classList.remove("visible");
        return;
      }
      try {
        const response = await authFetch(`${CONFIG.api.endpoints.tags}?prefix=${encodeURIComponent(prefix)}`);
        if (!response.ok) throw new Error("Failed to fetch tag suggestions");
        const data = await response.json();
        const names = currentTagNames();
        const suggestions = data.data.tags.filter(
          (t) => !names.some((existing) => existing.toLowerCase() === t.name.toLowerCase())
        );
        if (suggestions.length === 0) {
          autocompleteList.classList.remove("visible");
          return;
        }
        autocompleteList.innerHTML = suggestions
          .map((t) => `<button type="button" class="tag-autocomplete-item" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`)
          .join("");
        autocompleteList.classList.add("visible");
        autocompleteList.querySelectorAll(".tag-autocomplete-item").forEach((item) => {
          item.addEventListener("click", () => {
            applyTagChange([...currentTagNames(), item.dataset.name]);
            input.value = "";
            autocompleteList.classList.remove("visible");
            input.focus();
          });
        });
      } catch (error) {
        if (!(error instanceof SessionExpiredError)) {
          console.error("Failed to fetch tag suggestions:", error);
        }
      }
    }, 250);

    input.addEventListener("input", () => showSuggestions(input.value.trim()));
    input.addEventListener("blur", () => {
      setTimeout(() => autocompleteList.classList.remove("visible"), 150);
    });
  }
}

async function saveEntryText(entryId, newText) {
  const response = await authFetch(`${CONFIG.api.endpoints.entries}/${entryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputText: newText }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || "Failed to save changes");
  }
  return response.json();
}

function bindDetailTextEditor(card, entryId) {
  const editBtn = card.querySelector("#detailEditTextBtn");
  const bodyEl = card.querySelector("#detailBodyText");
  const promptRow = card.querySelector("#reExtractPromptRow");
  if (!editBtn || !bodyEl) return;

  editBtn.addEventListener("click", () => {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) return;

    promptRow.innerHTML = "";
    bodyEl.outerHTML = `
      <div class="detail-text-editor" id="detailTextEditorWrap" style="flex: 1;">
        <textarea id="detailTextInput">${escapeHtml(entry.input_text)}</textarea>
        <div class="detail-text-editor-actions">
          <button type="button" class="btn-cancel" id="detailTextCancelBtn">Cancel</button>
          <button type="button" class="btn-submit" id="detailTextSaveBtn">Save</button>
        </div>
      </div>
    `;
    editBtn.style.display = "none";

    const textarea = card.querySelector("#detailTextInput");
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    card.querySelector("#detailTextCancelBtn").addEventListener("click", () => {
      openEntryDetail(entryId);
    });

    card.querySelector("#detailTextSaveBtn").addEventListener("click", async () => {
      const newText = textarea.value.trim();
      if (!newText) {
        showAlert("Entry text can't be empty", "error");
        return;
      }
      const saveBtn = card.querySelector("#detailTextSaveBtn");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        await saveEntryText(entryId, newText);
        const liveEntry = state.entries.find((e) => e.id === entryId);
        if (liveEntry) liveEntry.input_text = newText;
        renderEntries();
        openEntryDetail(entryId);
        showReExtractPrompt(entryId, newText);
      } catch (error) {
        if (!(error instanceof SessionExpiredError)) {
          showAlert(`Failed to save changes: ${error.message}`, "error");
        }
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    });
  });
}

// Shown once, right after a successful text edit - re-extraction is
// always opt-in (extract.js appends action points rather than
// replacing them, so silently re-running it on every edit would create
// duplicates; this lets the user decide instead).
function showReExtractPrompt(entryId, newText) {
  const promptRow = document.querySelector(`#conversationDetail[data-entry-id="${entryId}"] #reExtractPromptRow`);
  if (!promptRow) return;
  promptRow.innerHTML = `
    <div class="re-extract-prompt">
      <span>Re-run AI reflection on the edited text?</span>
      <button type="button" class="btn-secondary" id="reExtractBtn">Re-run</button>
    </div>
  `;
  document.getElementById("reExtractBtn").addEventListener("click", async () => {
    const btn = document.getElementById("reExtractBtn");
    btn.disabled = true;
    btn.textContent = "Working…";
    try {
      const response = await authFetch(CONFIG.api.endpoints.extract, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId,
          userInput: newText,
          clearIncompleteActionPoints: true,
          today: localDateString(),
        }),
      });
      if (!response.ok) throw new Error("Failed to re-run extraction");
      // The extract response's actionPoints list is only the freshly
      // created rows for this call, not the entry's full set (completed
      // ones from before the edit were deliberately kept server-side but
      // aren't included there) - refetch the canonical list instead of
      // trusting that partial response, so completed action points don't
      // appear to vanish from the UI even though they survived in the DB.
      await loadEntries();
      openEntryDetail(entryId);
      showAlert("Reflection updated", "success");
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showAlert(`Failed to re-run extraction: ${error.message}`, "error");
      }
      btn.disabled = false;
      btn.textContent = "Re-run";
    }
  });
}

// Opens an entry inline in the main content area (replacing whichever
// view is currently showing), not as a popup - matches how Claude/ChatGPT
// load a past conversation into the main pane. Remembers which view was
// active beforehand so the Back button returns there instead of always
// going home.
export function openEntryDetail(entryId, { returnView } = {}) {
  const entry = state.entries.find((e) => e.id === entryId);
  if (!entry) return;

  if (returnView) {
    state.conversationReturnView = returnView;
  } else {
    const previousView = document.querySelector(".view.active");
    if (previousView && previousView.id !== "conversationView") {
      state.conversationReturnView = previousView.id;
    }
  }

  const date = new Date(entry.created_at);
  const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const card = document.getElementById("conversationDetail");
  card.dataset.entryId = entryId;
  card.innerHTML = `
    <div class="detail-header">
      ${badgeHtml(entry.input_type)}
      <span class="detail-datetime">${dateStr} &middot; ${timeStr}</span>
    </div>

    <div class="detail-body-row">
      <div class="detail-body" id="detailBodyText">${escapeHtml(entry.input_text)}</div>
      ${entry.isTemporary ? "" : '<button type="button" class="detail-edit-btn" id="detailEditTextBtn" aria-label="Edit entry text">&#9998;</button>'}
    </div>
    <div id="reExtractPromptRow"></div>

    ${
      entry.isExtracting
        ? `<div class="detail-section">${extractionThinkingHtml()}</div>`
        : `
          <div class="detail-section" id="detailActionPointsSection">${actionPointsHtml(entry.action_points)}</div>
          <div class="detail-section" id="detailReflectionSection">${reflectionHtml(entry.reflection)}</div>
        `
    }
    ${entry.isTemporary ? "" : detailTagEditorHtml(entry.tags || [])}
    <div class="detail-section">${chatThreadHtml(entry)}</div>
  `;

  bindActionPointHandlers(card);
  if (!entry.isTemporary) {
    bindDetailTagEditor(card, entryId);
    bindDetailTextEditor(card, entryId);
  }

  showView("conversationView");

  if (entry.clarifying_question) {
    loadChatThread(entryId);
    const chatForm = document.getElementById("chatForm");
    if (chatForm) {
      chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        sendChatMessage(entryId);
      });
    }
  }
}

export function closeEntryDetail() {
  showView(state.conversationReturnView || "homeView");
}

// Shared by the sidebar's "New Entry" button and the brand/logo click:
// both start a fresh "new chat", returning to the home view.
export function startNewChat({ focusInput = false } = {}) {
  showView("homeView");
  clearForm();
  if (focusInput) document.getElementById("textInput").focus();
  if (isMobileViewport()) closeSidebarDrawer();
}
