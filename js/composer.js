// ===== Composer =====
// Entry submission, voice recording, waveform, transcript, tag input,
// recording preview.
import { CONFIG, MAX_AUDIO_UPLOAD_BYTES, state, SessionExpiredError } from "./state.js";
import { authFetch, isOfflineError } from "./api.js";
import { showAlert, escapeHtml, debounce, localDateString, blobToBase64, clearForm } from "./ui-shell.js";
import { loadEntries, renderEntries, openEntryDetail } from "./entries.js";
import { sendHomeReply } from "./chat.js";

// ===== Composer Tag Input =====
export function renderComposerTagChips() {
  const container = document.getElementById("composerTagChips");
  if (!container) return;
  container.innerHTML = state.composerTags
    .map(
      (name, i) => `
    <span class="tag-chip" data-index="${i}">
      ${escapeHtml(name)}
      <button type="button" class="tag-chip-remove" data-index="${i}" aria-label="Remove tag">&times;</button>
    </span>
  `
    )
    .join("");
  container.querySelectorAll(".tag-chip-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.composerTags.splice(Number(btn.dataset.index), 1);
      renderComposerTagChips();
    });
  });
}

export function addComposerTag(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (state.composerTags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return;
  state.composerTags.push(trimmed);
  renderComposerTagChips();
}

export function bindComposerTagInput() {
  const input = document.getElementById("composerTagInput");
  const autocompleteList = document.getElementById("composerTagAutocomplete");
  if (!input || !autocompleteList) return;

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addComposerTag(input.value);
      input.value = "";
      autocompleteList.classList.remove("visible");
    }
  });

  const showSuggestions = debounce(async (prefix) => {
    if (!prefix) {
      autocompleteList.classList.remove("visible");
      return;
    }
    try {
      const response = await authFetch(`${CONFIG.api.endpoints.tags}?prefix=${encodeURIComponent(prefix)}`);
      if (!response.ok) throw new Error("Failed to fetch tag suggestions");
      const data = await response.json();
      const suggestions = data.data.tags.filter(
        (t) => !state.composerTags.some((existing) => existing.toLowerCase() === t.name.toLowerCase())
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
          addComposerTag(item.dataset.name);
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

// ===== Entry Functions =====
export async function submitEntry(inputType, inputText) {
  // Only a bare composer submission (no args - typed directly into
  // #textInput and sent) goes through the AI's chat-vs-entry judgment
  // below. A call from handleSendMode() always passes explicit args,
  // even for its "Text only" option (inputType "text" there too) -
  // that's someone who recorded and deliberately reviewed a
  // transcript before sending, a stronger intent signal than typing a
  // quick line, so it keeps the unconditional "always a real entry"
  // behavior same as voice.
  const isBareComposerSubmission = inputType === undefined;
  if (isBareComposerSubmission) {
    inputType = "text";
    inputText = document.getElementById("textInput").value.trim();
  }

  if (!inputText) {
    showAlert(inputType === "voice" ? "Please record audio first" : "Please enter text", "error");
    return;
  }

  if (state.isTemporaryMode) {
    const tempEntry = {
      id: crypto.randomUUID(),
      user_id: state.user?.id,
      input_type: inputType,
      input_text: inputText,
      title: null,
      reflection: null,
      clarifying_question: null,
      has_audio: false,
      action_points: [],
      tags: state.composerTags.map((name) => ({ id: name, name })),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      isTemporary: true,
      isExtracting: true,
    };
    state.entries.unshift(tempEntry);
    renderEntries();
    closeRecordingPreview();
    clearForm();
    openEntryDetail(tempEntry.id);
    showAlert("Temporary entry added (won't be saved)", "success");

    try {
      const extractResponse = await authFetch(CONFIG.api.endpoints.extract, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput: inputText, today: localDateString() }),
      });
      if (!extractResponse.ok) throw new Error("Failed to extract insights");
      const extractData = await extractResponse.json();
      const extraction = extractData.data.extraction;

      tempEntry.title = extraction.title;
      tempEntry.reflection = extraction.reflection;
      tempEntry.clarifying_question = extraction.clarifyingQuestion;
      tempEntry.temp_action_points = extraction.actionPoints;
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showAlert(`Couldn't get AI insights for temporary entry: ${error.message}`, "error");
      }
    } finally {
      tempEntry.isExtracting = false;
      renderEntries();
      // The detail view is a separate DOM tree from the card list
      // renderEntries() updates above - if the user is still looking
      // at this entry's detail (the common case, since it was just
      // opened), re-render it too so the thinking placeholder is
      // replaced with the real reflection/action points instead of
      // being stuck showing "thinking" indefinitely.
      if (document.querySelector(`#conversationDetail[data-entry-id="${tempEntry.id}"]`)) {
        openEntryDetail(tempEntry.id);
      }
    }
    return;
  }

  if (isBareComposerSubmission) {
    const content = inputText;
    clearForm();
    await sendHomeReply(content);
    return;
  }

  const audioBlobToUpload = inputType === "voice" && !state.audioTooLarge ? state.audioBlob : null;

  try {
    const createResponse = await authFetch(CONFIG.api.endpoints.entries, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputType, inputText, tags: state.composerTags }),
    });

    if (!createResponse.ok) throw new Error("Failed to create entry");

    const createData = await createResponse.json();
    const entryId = createData.data.entry.id;

    if (audioBlobToUpload) {
      try {
        const audioBase64 = await blobToBase64(audioBlobToUpload);
        const audioResponse = await authFetch(`${CONFIG.api.endpoints.entries}/${entryId}/audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBase64, mimeType: audioBlobToUpload.type || "audio/webm" }),
        });
        if (!audioResponse.ok) throw new Error("Audio upload failed");
      } catch (audioError) {
        if (!(audioError instanceof SessionExpiredError)) {
          showAlert("Audio couldn't be saved, but your entry was created", "error");
        }
      }
    }

    closeRecordingPreview();
    clearForm();

    // Open the entry right away, with a placeholder standing in for
    // the reflection/action points while extraction runs in the
    // background - avoids a "Extracting insights…" toast (or two)
    // ahead of the entry appearing, and reads more like a live
    // response filling in than a loading state you wait through.
    await loadEntries();
    const entry = state.entries.find((e) => e.id === entryId);
    if (entry) entry.isExtracting = true;
    openEntryDetail(entryId);

    try {
      const extractResponse = await authFetch(CONFIG.api.endpoints.extract, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, userInput: inputText, today: localDateString() }),
      });

      if (!extractResponse.ok) throw new Error("Failed to extract insights");
      await loadEntries();
    } catch (extractError) {
      if (!(extractError instanceof SessionExpiredError)) {
        showAlert(`Couldn't get AI insights: ${extractError.message}`, "error");
      }
      const failedEntry = state.entries.find((e) => e.id === entryId);
      if (failedEntry) failedEntry.isExtracting = false;
    } finally {
      if (document.querySelector(`#conversationDetail[data-entry-id="${entryId}"]`)) {
        openEntryDetail(entryId);
      } else {
        renderEntries();
      }
    }
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) {
      if (isOfflineError(error)) {
        // Deliberately don't clear the composer here - the text (and any
        // recorded audio, still held in state.audioBlob) stays exactly as
        // typed so hitting Save again once back online just works, rather
        // than a generic error making it look like the draft was lost.
        showAlert("You're offline. Your entry is still here, hit Save again once you're back online.", "error");
      } else {
        showAlert(`Failed to submit entry: ${error.message}`, "error");
      }
    }
  }
}

// ===== Voice Functions =====
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
let speechUnsupportedNoticeShown = false;

export function initVoiceRecognition() {
  if (!SpeechRecognition) {
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = CONFIG.voice.continuous;
  recognition.interimResults = CONFIG.voice.interimResults;
  recognition.language = CONFIG.voice.language;

  recognition.onstart = () => {
    state.recognitionActive = true;
    // A (re)started recognition session's event.results always restarts at index 0,
    // so anything accumulated before this session (e.g. before a pause) must be kept
    // as a fixed prefix rather than re-summed by this session's own results.
    state.transcriptPrefix = state.finalTranscript;
  };

  recognition.onresult = (event) => {
    let sessionFinal = "";
    let sessionInterim = "";
    for (let i = 0; i < event.results.length; i++) {
      const resultText = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        sessionFinal += resultText;
      } else {
        sessionInterim += resultText;
      }
    }
    state.finalTranscript = state.transcriptPrefix + sessionFinal;
    state.interimTranscript = sessionInterim;
    writeLiveTranscript();
  };

  recognition.onend = () => {
    state.recognitionActive = false;
  };

  recognition.onerror = (event) => {
    state.recognitionActive = false;
    if (event.error === "no-speech" || event.error === "aborted") return;
    showAlert(`Voice error: ${event.error}`, "error");
    // A speech-recognition failure shouldn't leave an orphaned MediaRecorder running.
    if (state.composerMode === "recording" || state.composerMode === "paused") {
      cancelRecording();
    }
  };
}

export function writeLiveTranscript() {
  document.getElementById("textInput").value = state.finalTranscript + state.interimTranscript;
  autoGrowTextarea();
}

export function autoGrowTextarea() {
  const textarea = document.getElementById("textInput");
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export function setComposerMode(mode) {
  state.composerMode = mode;
  const composer = document.getElementById("composer");
  composer.classList.remove("composer--recording", "composer--paused");
  if (mode === "recording") composer.classList.add("composer--recording");
  if (mode === "paused") composer.classList.add("composer--paused");
  document.getElementById("micBtn").classList.toggle("is-recording", mode === "recording");
}

export function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function startTimer() {
  state.recordingStartedAt = Date.now();
  state.timerIntervalId = setInterval(() => {
    const elapsed = Date.now() - state.recordingStartedAt + state.pausedElapsedMs;
    document.getElementById("recTimer").textContent = formatTimer(elapsed);
  }, 250);
}

export function stopTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
}

export function startWaveform() {
  const bars = document.querySelectorAll("#recWaveform .bar");
  const dataArray = new Uint8Array(state.analyserNode.frequencyBinCount);

  function animate() {
    state.analyserNode.getByteFrequencyData(dataArray);
    const step = Math.floor(dataArray.length / bars.length) || 1;
    bars.forEach((bar, i) => {
      const value = dataArray[i * step] / 255;
      const scale = Math.max(0.15, Math.min(1, value));
      bar.style.transform = `scaleY(${scale})`;
    });
    state.waveformRafId = requestAnimationFrame(animate);
  }
  animate();
}

export function stopWaveform() {
  if (state.waveformRafId) {
    cancelAnimationFrame(state.waveformRafId);
    state.waveformRafId = null;
  }
}

export async function startRecording() {
  if (state.composerMode !== "idle") return;

  state.textBeforeRecording = document.getElementById("textInput").value;
  state.cancelled = false;
  state.audioChunks = [];
  state.audioTooLarge = false;
  state.finalTranscript = "";
  state.interimTranscript = "";
  state.transcriptPrefix = "";
  state.pausedElapsedMs = 0;
  document.getElementById("pauseResumeBtn").setAttribute("aria-label", "Pause recording");
  document.getElementById("pauseResumeIcon").innerHTML =
    '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    showAlert("Microphone access denied. Please allow microphone permission to record.", "error");
    return;
  }

  state.mediaStream = stream;
  stream.getAudioTracks()[0].addEventListener("ended", () => {
    if (state.composerMode === "recording" || state.composerMode === "paused") {
      cancelRecording();
    }
  });

  state.mediaRecorder = new MediaRecorder(stream);
  state.mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) state.audioChunks.push(e.data);
  };
  state.mediaRecorder.onstop = () => {
    if (state.cancelled) return;
    const mimeType = state.mediaRecorder.mimeType || "audio/webm";
    state.audioBlob = new Blob(state.audioChunks, { type: mimeType });
    state.audioObjectUrl = URL.createObjectURL(state.audioBlob);
    state.audioTooLarge = state.audioBlob.size > MAX_AUDIO_UPLOAD_BYTES;
    if (state.audioTooLarge) {
      showAlert(
        "Recording is too long to save audio (max ~15 min). Your transcript will still be saved, but the audio recording will be discarded.",
        "error"
      );
    }
    openRecordingPreview();
  };
  state.mediaRecorder.start();

  state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  state.analyserNode = state.audioContext.createAnalyser();
  state.analyserNode.fftSize = 32;
  state.audioContext.createMediaStreamSource(stream).connect(state.analyserNode);
  startWaveform();
  startTimer();

  if (SpeechRecognition) {
    try {
      recognition.start();
    } catch (err) {
      // already started; ignore
    }
  } else if (!speechUnsupportedNoticeShown) {
    speechUnsupportedNoticeShown = true;
    showAlert("Live transcription isn't supported in this browser. You can type the transcript after recording.", "info");
  }

  setComposerMode("recording");
}

export function pauseRecording() {
  if (state.composerMode !== "recording") return;
  if (typeof state.mediaRecorder.pause !== "function") return;

  state.mediaRecorder.pause();
  state.pausedElapsedMs += Date.now() - state.recordingStartedAt;
  stopTimer();
  stopWaveform();
  if (state.recognitionActive) recognition.stop();

  setComposerMode("paused");
  document.getElementById("pauseResumeBtn").setAttribute("aria-label", "Resume recording");
  document.getElementById("pauseResumeIcon").innerHTML = '<path d="M8 5v14l11-7z"></path>';
}

export function resumeRecording() {
  if (state.composerMode !== "paused") return;

  state.mediaRecorder.resume();
  state.recordingStartedAt = Date.now();
  startTimer();
  startWaveform();
  if (SpeechRecognition) {
    try {
      recognition.start();
    } catch (err) {
      // already started; ignore
    }
  }

  setComposerMode("recording");
  document.getElementById("pauseResumeBtn").setAttribute("aria-label", "Pause recording");
  document.getElementById("pauseResumeIcon").innerHTML =
    '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';
}

export function togglePauseResume() {
  if (state.composerMode === "recording") pauseRecording();
  else if (state.composerMode === "paused") resumeRecording();
}

export function cancelRecording() {
  state.cancelled = true;
  teardownRecordingResources();
  document.getElementById("textInput").value = state.textBeforeRecording;
  autoGrowTextarea();
  setComposerMode("idle");
}

export function finishRecording() {
  if (state.composerMode !== "recording" && state.composerMode !== "paused") return;
  teardownRecordingResources();
  setComposerMode("idle");
  // openRecordingPreview() is triggered by mediaRecorder.onstop once the blob is assembled
}

export function teardownRecordingResources() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((t) => t.stop());
    state.mediaStream = null;
  }
  if (state.audioContext && state.audioContext.state !== "closed") {
    state.audioContext.close();
  }
  state.audioContext = null;
  state.analyserNode = null;
  stopWaveform();
  stopTimer();
  if (state.recognitionActive && recognition) {
    recognition.stop();
  }
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }
}

window.addEventListener("beforeunload", () => {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((t) => t.stop());
  }
});

// ===== Recording Preview =====
export function openRecordingPreview() {
  state.composerMode = "previewing";
  document.getElementById("previewAudio").src = state.audioObjectUrl;
  document.getElementById("previewTranscript").value = state.finalTranscript.trim();
  document.getElementById("previewAdditionalText").value = "";
  document.getElementById("previewScrubber").value = 0;
  document.getElementById("previewTime").textContent = "0:00 / 0:00";
  setPreviewPlayIcon(false);
  document.getElementById("recordingPreviewOverlay").classList.add("active");
}

export function closeRecordingPreview() {
  const audio = document.getElementById("previewAudio");
  audio.pause();
  document.getElementById("recordingPreviewOverlay").classList.remove("active");
  if (state.audioObjectUrl) {
    URL.revokeObjectURL(state.audioObjectUrl);
    state.audioObjectUrl = null;
  }
  state.audioBlob = null;
  state.audioChunks = [];
  if (state.composerMode === "previewing") setComposerMode("idle");
}

export function setPreviewPlayIcon(isPlaying) {
  const icon = document.getElementById("previewPlayIcon");
  icon.innerHTML = isPlaying
    ? '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>'
    : '<path d="M8 5v14l11-7z"></path>';
  document.getElementById("previewPlayBtn").setAttribute("aria-label", isPlaying ? "Pause" : "Play");
}

export function deleteRecording() {
  closeRecordingPreview();
  document.getElementById("textInput").value = "";
  autoGrowTextarea();
}

export function reRecordFromPreview() {
  closeRecordingPreview();
  startRecording();
}

export function handleSendMode(mode) {
  const transcript = document.getElementById("previewTranscript").value.trim();
  const additionalText = document.getElementById("previewAdditionalText").value.trim();

  if (!transcript && mode !== "text") {
    showAlert("Please record audio first", "error");
    return;
  }

  let inputType;
  let inputText;
  if (mode === "voice") {
    inputType = "voice";
    inputText = transcript;
  } else if (mode === "text") {
    inputType = "text";
    inputText = transcript;
  } else {
    inputType = "voice";
    inputText = [transcript, additionalText].filter(Boolean).join("\n\n");
  }

  submitEntry(inputType, inputText);
}
