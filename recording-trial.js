class OrukRecordingTrialPlugin {
  constructor(jsPsych) {
    this.jsPsych = jsPsych;
  }

  trial(displayElement, trial) {
    const recorder = this.jsPsych.pluginAPI.getMicrophoneRecorder();
    if (!recorder) {
      displayElement.innerHTML = '<main class="study-card"><h1>Microphone unavailable</h1><p>Please allow microphone access and reload the study.</p></main>';
      return;
    }

    let chunks = [];
    let audioBase64 = null;
    let audioUrl = null;
    let startedAt = null;
    let durationMs = null;
    let attempts = 0;
    let stopTimer = null;

    displayElement.innerHTML = `
      <main class="study-card recording-card">
        ${trial.content}
        <section class="recorder" aria-live="polite">
          <div class="recording-status" id="recording-status">
            <span class="status-dot" aria-hidden="true"></span>
            <span id="status-text">Ready to record</span>
            <span class="recording-time" id="recording-time"></span>
          </div>
          <button class="record-toggle" id="record-toggle" type="button">
            <span class="record-icon" aria-hidden="true"></span>
            <span id="record-label">Start recording</span>
          </button>
          <div class="review-panel" id="review-panel" hidden>
            <p class="review-label">Listen before submitting</p>
            <audio id="recording-playback" controls></audio>
            <div class="review-actions">
              <button class="secondary-action" id="record-again" type="button">Record again</button>
              <button class="primary-action" id="accept-recording" type="button">Use this recording</button>
            </div>
          </div>
        </section>
      </main>`;

    const toggle = displayElement.querySelector("#record-toggle");
    const label = displayElement.querySelector("#record-label");
    const status = displayElement.querySelector("#recording-status");
    const statusText = displayElement.querySelector("#status-text");
    const time = displayElement.querySelector("#recording-time");
    const review = displayElement.querySelector("#review-panel");
    const playback = displayElement.querySelector("#recording-playback");
    const again = displayElement.querySelector("#record-again");
    const accept = displayElement.querySelector("#accept-recording");

    const cleanupUrl = () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    };

    const blobToBase64 = (blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const showReady = () => {
      status.classList.remove("is-recording", "is-recorded");
      statusText.textContent = "Ready to record";
      time.textContent = "";
      toggle.classList.remove("is-recording");
      toggle.hidden = false;
      label.textContent = "Start recording";
      review.hidden = true;
      toggle.focus();
    };

    const stopRecording = () => {
      if (recorder.state !== "recording") return;
      window.clearTimeout(stopTimer);
      durationMs = Math.round(performance.now() - startedAt);
      recorder.stop();
      toggle.disabled = true;
      label.textContent = "Preparing playback…";
    };

    const startRecording = () => {
      cleanupUrl();
      chunks = [];
      audioBase64 = null;
      durationMs = null;
      attempts += 1;
      review.hidden = true;
      toggle.disabled = false;
      toggle.hidden = false;
      toggle.classList.add("is-recording");
      label.textContent = "Stop recording";
      status.classList.add("is-recording");
      status.classList.remove("is-recorded");
      statusText.textContent = "Recording";
      startedAt = performance.now();
      time.textContent = `Maximum ${Math.round(trial.maximum_duration / 1000)} seconds`;
      recorder.start();
      stopTimer = window.setTimeout(stopRecording, trial.maximum_duration);
    };

    const onData = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };

    const onStop = async () => {
      const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });
      audioBase64 = await blobToBase64(blob);
      audioUrl = URL.createObjectURL(blob);
      playback.src = audioUrl;
      toggle.hidden = true;
      toggle.disabled = false;
      review.hidden = false;
      status.classList.remove("is-recording");
      status.classList.add("is-recorded");
      statusText.textContent = "Recording complete";
      time.textContent = `${(durationMs / 1000).toFixed(1)} seconds`;
      playback.focus();
    };

    recorder.addEventListener("dataavailable", onData);
    recorder.addEventListener("stop", onStop);

    toggle.addEventListener("click", () => {
      if (recorder.state === "recording") stopRecording();
      else startRecording();
    });

    again.addEventListener("click", showReady);

    accept.addEventListener("click", () => {
      if (!audioBase64) return;
      recorder.removeEventListener("dataavailable", onData);
      recorder.removeEventListener("stop", onStop);
      window.clearTimeout(stopTimer);
      cleanupUrl();
      this.jsPsych.finishTrial({
        response: trial.practice ? "[practice recording discarded]" : audioBase64,
        mime_type: recorder.mimeType || "audio/webm",
        recording_duration_ms: durationMs,
        recording_attempts: attempts,
      });
    });
  }
}

OrukRecordingTrialPlugin.info = {
  name: "oruk-recording-trial",
  version: "0.1.1",
  parameters: {
    content: { type: "HTML_STRING", default: undefined },
    maximum_duration: { type: "INT", default: 15000 },
    practice: { type: "BOOL", default: false },
  },
  data: {
    response: { type: "STRING" },
    mime_type: { type: "STRING" },
    recording_duration_ms: { type: "INT" },
    recording_attempts: { type: "INT" },
  },
};

window.jsPsychOrukRecordingTrial = OrukRecordingTrialPlugin;
