// ===== Action Points =====
// To-do list, action point CRUD, reminders, due dates.
import { CONFIG, state, SessionExpiredError } from "./state.js";
import { authFetch } from "./api.js";
import { showAlert, escapeHtml, truncate, localDateString, toLocalDateTimeInputValue } from "./ui-shell.js";

// ===== To-do List =====
export async function loadTodoList() {
  try {
    const response = await authFetch(CONFIG.api.endpoints.actionPoints);
    if (!response.ok) throw new Error("Failed to load action points");
    const data = await response.json();
    state.todoActionPoints = data.data.actionPoints;
    renderTodoList();
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      showAlert(`Failed to load to-do list: ${error.message}`, "error");
    }
  }
}

// Sort key for the Due column: overdue first (oldest overdue first),
// then today, then soonest upcoming, then no-due-date items last
// (grouped at the end rather than mixed in, since "no date" isn't
// orderable against real dates).
function dueSortValue(dueDate) {
  if (!dueDate) return Infinity;
  const dateStr = typeof dueDate === "string" ? dueDate.slice(0, 10) : localDateString(new Date(dueDate));
  return new Date(`${dateStr}T00:00:00`).getTime();
}

function todoItemHtml(ap) {
  return `
    <div class="action-point todo-item${ap.completed ? " completed" : ""}" data-id="${ap.id}" data-entry-id="${ap.entry_id}">
      <div class="action-point-box"></div>
      <div class="action-point-text">${escapeHtml(ap.text)}</div>
      ${dueDateLabelHtml(ap.due_date, ap.completed)}
      ${reminderLabelHtml(ap.remind_at)}
      ${reminderSuggestionHtml(ap)}
      <button type="button" class="action-point-remind${ap.remind_at ? " has-reminder" : ""}" data-id="${ap.id}" data-remind-at="${ap.remind_at || ""}" title="${ap.remind_at ? "Reminder set" : "Set reminder"}">&#128276;</button>
      <div class="todo-item-source">${escapeHtml(truncate(ap.entry_input_text, 60))}</div>
    </div>
  `;
}

export function renderTodoList() {
  const container = document.getElementById("todoList");
  if (state.todoActionPoints.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>Nothing to do</h3><p>Action points from your entries will show up here.</p></div>';
    return;
  }

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;

  const due = [];
  const completed = [];
  for (const ap of state.todoActionPoints) {
    if (!ap.completed) {
      due.push(ap);
      continue;
    }
    // Completed column resets monthly: only show items completed in
    // the current calendar month (local time). Older completions
    // aren't deleted, just no longer listed here - they're still on
    // their original entry.
    if (!ap.completed_at) continue;
    const completedDate = new Date(ap.completed_at);
    if (Number.isNaN(completedDate.getTime())) continue;
    const completedMonthKey = `${completedDate.getFullYear()}-${completedDate.getMonth()}`;
    if (completedMonthKey === currentMonthKey) completed.push(ap);
  }

  due.sort((a, b) => dueSortValue(a.due_date) - dueSortValue(b.due_date));
  completed.sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());

  const dueColumnBody = due.length
    ? due.map(todoItemHtml).join("")
    : '<div class="todo-column-empty">Nothing due right now.</div>';
  const completedColumnBody = completed.length
    ? completed.map(todoItemHtml).join("")
    : '<div class="todo-column-empty">Nothing completed this month yet.</div>';

  container.innerHTML = `
    <div class="todo-columns">
      <div class="todo-column">
        <div class="todo-column-header">Due &middot; ${due.length}</div>
        <div class="todo-column-body">${dueColumnBody}</div>
      </div>
      <div class="todo-column">
        <div class="todo-column-header">Completed &middot; ${completed.length}</div>
        <div class="todo-column-body">${completedColumnBody}</div>
      </div>
    </div>
  `;
  bindActionPointHandlers(container, {
    // Update the source array with the saved row (completed,
    // completed_at, etc.) and re-render, so checking a task off moves
    // it into the Completed column immediately instead of just
    // leaving a strikethrough in the Due column until the next full
    // reload.
    onToggled: (apId, updatedAp) => {
      const index = state.todoActionPoints.findIndex((ap) => ap.id === apId);
      if (index !== -1) state.todoActionPoints[index] = { ...state.todoActionPoints[index], ...updatedAp };
      renderTodoList();
    },
  });
}

export function badgeHtml(inputType) {
  const isVoice = inputType === "voice";
  const icon = isVoice
    ? '<span class="badge-icon-voice"><span></span><span></span><span></span></span>'
    : '<span class="badge-icon-text"><span></span><span></span><span></span></span>';
  return `<span class="entry-badge ${isVoice ? "voice" : "text"}">${icon}${isVoice ? "Voice" : "Text"}</span>`;
}

// Renders a due-date pill ("Due today", "Due tomorrow", "Due Mon",
// "Overdue") from an action point's due_date (a plain YYYY-MM-DD date,
// no time component - compared by calendar day, not by 24h windows,
// so "today" means the same day regardless of what time it currently is).
export function dueDateLabelHtml(dueDate, completed) {
  if (!dueDate) return "";

  // Postgres DATE columns come back as either "YYYY-MM-DD" or a full
  // Date already; normalize to just the date part either way.
  const dateStr = typeof dueDate === "string" ? dueDate.slice(0, 10) : localDateString(new Date(dueDate));
  const due = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(due.getTime())) return "";

  const today = new Date(`${localDateString()}T00:00:00`);
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((due.getTime() - today.getTime()) / dayMs);

  let text;
  let variant = "";
  if (diffDays === 0) {
    text = "Due today";
    variant = "today";
  } else if (diffDays === 1) {
    text = "Due tomorrow";
  } else if (diffDays > 1 && diffDays < 7) {
    text = `Due ${due.toLocaleDateString("en-US", { weekday: "short" })}`;
  } else if (diffDays < 0) {
    text = "Overdue";
    variant = "overdue";
  } else {
    text = `Due ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }

  // A completed task's due date is no longer actionable information,
  // so it never renders as "overdue" - just a neutral reference date.
  if (completed && variant === "overdue") variant = "";

  return `<span class="action-point-due${variant ? ` action-point-due--${variant}` : ""}">${text}</span>`;
}

// Renders a compact "when" label for an existing reminder (set via the
// bell icon), e.g. "Jul 20, 9:00 AM" - the bell button itself only
// shows set/not-set via color, this surfaces the actual time.
function reminderLabelHtml(remindAt) {
  if (!remindAt) return "";
  const date = new Date(remindAt);
  if (Number.isNaN(date.getTime())) return "";
  const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `<span class="action-point-reminder-label" title="Reminder set">&#128276; ${dateStr}, ${timeStr}</span>`;
}

// A one-click prompt shown only when the AI already detected a due
// date but no reminder has been set yet - the common case is "yes,
// remind me", so clicking sets a sensible default (9am on the due
// date) immediately rather than forcing the full picker open first.
// Never shown for a completed task (nothing left to be reminded about)
// or once a reminder already exists (reminderLabelHtml covers that).
function reminderSuggestionHtml(ap) {
  if (!ap.due_date || ap.remind_at || ap.completed) return "";
  const dateStr = typeof ap.due_date === "string" ? ap.due_date.slice(0, 10) : localDateString(new Date(ap.due_date));
  return `<button type="button" class="reminder-suggestion" data-id="${ap.id}" data-due-date="${dateStr}" title="Set a reminder for this">&#128276; Remind me?</button>`;
}

export function actionPointsHtml(actionPoints) {
  if (!actionPoints || actionPoints.length === 0) return "";
  return `
    <div class="action-points">
      <div class="action-points-label">Action Points &middot; ${actionPoints.length}</div>
      ${actionPoints
        .map(
          (ap) => `
        <div class="action-point${ap.completed ? " completed" : ""}" data-id="${ap.id}">
          <div class="action-point-box"></div>
          <div class="action-point-text">${escapeHtml(ap.text)}</div>
          ${dueDateLabelHtml(ap.due_date, ap.completed)}
          ${reminderLabelHtml(ap.remind_at)}
          ${reminderSuggestionHtml(ap)}
          <button type="button" class="action-point-remind${ap.remind_at ? " has-reminder" : ""}" data-id="${ap.id}" data-remind-at="${ap.remind_at || ""}" title="${ap.remind_at ? "Reminder set" : "Set reminder"}">&#128276;</button>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

export async function updateActionPoint(entryId, apId, fields) {
  const response = await authFetch(`${CONFIG.api.endpoints.entries}/${entryId}/action-points/${apId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || "Failed to update action point");
  }
  return response.json();
}

// onToggled(apId, updatedActionPoint), if given, fires after a
// completion toggle successfully saves - used by the to-do list to
// move the item into the Completed column immediately instead of just
// leaving a strikethrough in place (the right behavior for the
// detail/card views, where items don't belong to a completed/due
// grouping in the first place).
export function bindActionPointHandlers(root, { onToggled } = {}) {
  root.querySelectorAll(".action-point:not(.action-point--readonly)").forEach((point) => {
    point.addEventListener("click", async (e) => {
      if (
        e.target.closest(".action-point-remind") ||
        e.target.closest(".action-point-remind-picker") ||
        e.target.closest(".reminder-suggestion")
      ) {
        return;
      }
      e.stopPropagation();

      const entryCard = point.closest("[data-entry-id]");
      const entryId = entryCard?.dataset.entryId;
      const apId = point.dataset.id;
      const wasCompleted = point.classList.contains("completed");

      point.classList.toggle("completed");
      try {
        const updated = await updateActionPoint(entryId, apId, { completed: !wasCompleted });
        onToggled?.(apId, updated.data.actionPoint);
      } catch (err) {
        point.classList.toggle("completed");
        if (!(err instanceof SessionExpiredError)) {
          showAlert(`Failed to update action point: ${err.message}`, "error");
        }
      }
    });
  });

  root.querySelectorAll(".action-point-remind").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openReminderPicker(btn);
    });
  });

  root.querySelectorAll(".reminder-suggestion").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const point = btn.closest("[data-id]");
      const entryCard = btn.closest("[data-entry-id]");
      const entryId = entryCard?.dataset.entryId;
      const apId = btn.dataset.id;
      // 9am local on the due date - a reasonable default for "remind
      // me about this," editable afterward via the bell icon's picker
      // like any other reminder if 9am isn't right for this one.
      const remindAt = new Date(`${btn.dataset.dueDate}T09:00:00`).toISOString();

      btn.disabled = true;
      try {
        const updated = await updateActionPoint(entryId, apId, { remindAt });
        const remindBtn = point?.querySelector(".action-point-remind");
        if (remindBtn) {
          remindBtn.dataset.remindAt = remindAt;
          remindBtn.classList.add("has-reminder");
          remindBtn.title = "Reminder set";
        }
        const label = document.createElement("span");
        label.className = "action-point-reminder-label";
        label.title = "Reminder set";
        const d = new Date(remindAt);
        label.textContent = `🔔 ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
        btn.replaceWith(label);
      } catch (err) {
        btn.disabled = false;
        if (!(err instanceof SessionExpiredError)) {
          showAlert(`Failed to set reminder: ${err.message}`, "error");
        }
      }
    });
  });
}

export function openReminderPicker(btn) {
  const existing = btn.parentElement.querySelector(".action-point-remind-picker");
  if (existing) {
    existing.remove();
    return;
  }

  const entryCard = btn.closest("[data-entry-id]");
  const entryId = entryCard?.dataset.entryId;
  const apId = btn.dataset.id;
  const currentRemindAt = btn.dataset.remindAt;

  const picker = document.createElement("div");
  picker.className = "action-point-remind-picker";
  picker.innerHTML = `
    <input type="datetime-local" value="${toLocalDateTimeInputValue(currentRemindAt)}" />
    <button type="button" class="remind-save">Save</button>
    ${currentRemindAt ? '<button type="button" class="remind-clear">Clear</button>' : ""}
  `;
  picker.addEventListener("click", (e) => e.stopPropagation());
  btn.parentElement.appendChild(picker);

  const input = picker.querySelector("input");
  input.focus();

  picker.querySelector(".remind-save").addEventListener("click", async () => {
    if (!input.value) {
      picker.remove();
      return;
    }
    const isoValue = new Date(input.value).toISOString();
    try {
      await updateActionPoint(entryId, apId, { remindAt: isoValue });
      btn.dataset.remindAt = isoValue;
      btn.classList.add("has-reminder");
      btn.title = "Reminder set";
      picker.remove();
    } catch (err) {
      if (!(err instanceof SessionExpiredError)) {
        showAlert(`Failed to set reminder: ${err.message}`, "error");
      }
    }
  });

  const clearBtn = picker.querySelector(".remind-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      try {
        await updateActionPoint(entryId, apId, { remindAt: null });
        btn.dataset.remindAt = "";
        btn.classList.remove("has-reminder");
        btn.title = "Set reminder";
        picker.remove();
      } catch (err) {
        if (!(err instanceof SessionExpiredError)) {
          showAlert(`Failed to clear reminder: ${err.message}`, "error");
        }
      }
    });
  }
}
