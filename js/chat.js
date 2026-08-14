// ===== Chat =====
// Entry-level clarifying-question chat threads, and the home-page ongoing
// chat.
import { CONFIG, state, SessionExpiredError } from "./state.js";
import { authFetch } from "./api.js";
import { showToast, escapeHtml } from "./ui-shell.js";
import { loadEntries } from "./entries.js";

export function chatMessageHtml(role, content) {
  return `
    <div class="chat-message chat-message-${role}">
      <div class="chat-bubble">${escapeHtml(content)}</div>
    </div>
  `;
}

export function chatThreadHtml(entry) {
  if (!entry.clarifying_question) return "";
  return `
    <div class="chat-thread" data-entry-id="${entry.id}">
      <div class="clarifying-question-label" style="margin-bottom: 10px;">Clarifying Question</div>
      <div class="chat-messages" id="chatMessages">
        ${chatMessageHtml("assistant", entry.clarifying_question)}
      </div>
      <form class="chat-input-row" id="chatForm">
        <input type="text" id="chatInput" placeholder="Reply..." autocomplete="off" />
        <button type="submit" class="chat-send-btn">Send</button>
      </form>
    </div>
  `;
}

// ===== Clarifying Question Chat =====
export async function loadChatThread(entryId) {
  try {
    const response = await authFetch(`${CONFIG.api.endpoints.entries}/${entryId}/messages`);

    if (!response.ok) throw new Error("Failed to load conversation");

    const data = await response.json();
    const messagesEl = document.getElementById("chatMessages");
    if (!messagesEl) return;

    const entry = state.entries.find((e) => e.id === entryId);
    const html = [chatMessageHtml("assistant", entry.clarifying_question)];
    data.data.messages.forEach((m) => html.push(chatMessageHtml(m.role, m.content)));
    messagesEl.innerHTML = html.join("");
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      showToast(`Failed to load conversation: ${error.message}`, "error");
    }
  }
}

export async function sendChatMessage(entryId) {
  const input = document.getElementById("chatInput");
  const content = input.value.trim();
  if (!content) return;

  const messagesEl = document.getElementById("chatMessages");
  messagesEl.insertAdjacentHTML("beforeend", chatMessageHtml("user", content));
  messagesEl.scrollTop = messagesEl.scrollHeight;
  input.value = "";
  input.disabled = true;

  try {
    const response = await authFetch(`${CONFIG.api.endpoints.entries}/${entryId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) throw new Error("Failed to send message");

    const data = await response.json();
    messagesEl.insertAdjacentHTML("beforeend", chatMessageHtml("assistant", data.data.assistantMessage.content));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      showToast(`Failed to send message: ${error.message}`, "error");
    }
  } finally {
    input.disabled = false;
    input.focus();
  }
}

// ===== Home Chat =====
// Renders one bubble, adding a small "saved to your journal" marker
// when the message was judged journal-worthy and became a real entry
// (createdEntryId on a user message) - reuses chatMessageHtml's markup
// exactly, just appends the marker after it.
export function homeChatMessageHtml(message) {
  const base = chatMessageHtml(message.role, message.content);
  if (message.role !== "user" || !message.entry_id) return base;
  return base.replace(
    "</div></div>",
    `<span class="chat-bubble-entry-marker">Saved to your journal</span></div></div>`
  );
}

// The reply thread box is only shown once there's actually something
// in it - an empty bordered box under the composer before you've
// typed anything is just clutter, not a second input to notice.
export function updateHomeChatVisibility() {
  const container = document.getElementById("homeChat");
  const messagesEl = document.getElementById("homeReplyThread");
  if (!container || !messagesEl) return;
  container.classList.toggle("has-messages", messagesEl.children.length > 0);
}

export async function loadHomeReplyThread() {
  try {
    const response = await authFetch(CONFIG.api.endpoints.chat);
    if (!response.ok) throw new Error("Failed to load chat");

    const data = await response.json();
    const messagesEl = document.getElementById("homeReplyThread");
    if (!messagesEl) return;

    messagesEl.innerHTML = data.data.messages.map(homeChatMessageHtml).join("");
    messagesEl.scrollTop = messagesEl.scrollHeight;
    updateHomeChatVisibility();
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      console.error("Failed to load home reply thread:", error);
    }
  }
}

// Called from submitEntry() for a typed, non-temporary text
// submission - the AI decides (server-side, same judgment already
// verified live) whether this becomes a real journal entry or just a
// conversational reply, and either way the response appears inline
// here rather than navigating away from home. Voice recordings and
// Temporary chat mode never call this - they keep their own existing
// /api/entries + openEntryDetail behavior untouched.
export async function sendHomeReply(content) {
  const messagesEl = document.getElementById("homeReplyThread");
  if (messagesEl) {
    messagesEl.insertAdjacentHTML("beforeend", chatMessageHtml("user", content));
    messagesEl.scrollTop = messagesEl.scrollHeight;
    updateHomeChatVisibility();
  }

  try {
    const response = await authFetch(`${CONFIG.api.endpoints.chat}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) throw new Error("Failed to send message");

    const data = await response.json();
    if (messagesEl) {
      if (data.data.createdEntryId) {
        // Re-render the just-sent user bubble with the marker rather
        // than appending a duplicate - the optimistic bubble above
        // doesn't know yet whether this turned into an entry.
        const bubbles = messagesEl.querySelectorAll(".chat-message-user");
        const lastUserBubble = bubbles[bubbles.length - 1];
        if (lastUserBubble) {
          lastUserBubble.outerHTML = homeChatMessageHtml(data.data.userMessage);
        }
        loadEntries();
      }
      messagesEl.insertAdjacentHTML("beforeend", chatMessageHtml("assistant", data.data.assistantMessage.content));
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      showToast(`Failed to send message: ${error.message}`, "error");
    }
  }
}
