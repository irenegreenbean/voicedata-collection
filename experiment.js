(async function runStudy() {
  "use strict";

  const config = window.STUDY_CONFIG;
  const url = new URL(window.location.href);
  const isDirectFilePreview = url.protocol === "file:";
  const isDemoPreview = url.searchParams.get("DEMO") === "1";
  const collectionActive = config.collectionEnabled && !isDirectFilePreview && !isDemoPreview;
  const prolific = {
    pid: url.searchParams.get("PROLIFIC_PID") || "DEMO_PID",
    studyId: url.searchParams.get("STUDY_ID") || "DEMO_STUDY",
    sessionId: url.searchParams.get("SESSION_ID") || crypto.randomUUID(),
  };

  const randomCode = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const speakerId = randomCode("spk");
  const withdrawalCode = randomCode("wd");
  const uploads = [];
  const uploadJobs = [];
  const uploadFailures = [];
  let itemCount = 0;
  let fatalError = null;
  let demographics = null;
  let assignmentCondition = null;
  let uploadToken = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function shuffle(values) {
    const copy = [...values];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function extensionFor(mimeType) {
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("mp4")) return "m4a";
    return "webm";
  }

  async function collectorRequest(endpoint, body) {
    if (!collectionActive) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { message: "Demo mode: upload skipped" };
    }
    const apiBaseUrl = String(config.apiBaseUrl || "").replace(/\/$/, "");
    const response = await fetch(`${apiBaseUrl}/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.message || result.error || "Upload failed");
    return result;
  }

  async function withRetries(operation, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
    }
    throw lastError;
  }

  async function uploadAudio(data, item, interpretationId, presentationPosition) {
    const mimeType = data.mime_type || "audio/webm";
    const filename = `${item.pair_id}_${interpretationId}_${speakerId}.${extensionFor(mimeType)}`;
    await withRetries(() => collectorRequest("audio", {
        filename,
        data: data.response,
        upload_token: uploadToken,
        speaker_id: speakerId,
        pair_id: item.pair_id,
        interpretation_id: interpretationId,
        presentation_position: presentationPosition,
        mime_type: mimeType,
        recording_duration_ms: data.recording_duration_ms,
        recording_attempts: data.recording_attempts,
      }));
    uploads.push({
      filename,
      pair_id: item.pair_id,
      interpretation_id: interpretationId,
      presentation_position: presentationPosition,
      mime_type: mimeType,
      recording_duration_ms: data.recording_duration_ms,
      recording_attempts: data.recording_attempts,
      upload_succeeded: true,
    });
    data.response = `[uploaded:${filename}]`;
    delete data.audio_url;
  }

  function card(content, eyebrow = "Spoken interpretation study") {
    return `<main class="study-card"><p class="eyebrow">${escapeHtml(eyebrow)}</p>${content}</main>`;
  }

  function savingScreen(title, message, eyebrow = "Saving") {
    return card(`
      <div class="saving-indicator" aria-hidden="true"></div>
      <h2>${escapeHtml(title)}</h2>
      <p class="lede">${escapeHtml(message)}</p>
    `, eyebrow);
  }

  function promptContent(item, interpretationId, pairPosition, totalPairs, note) {
    const n = interpretationId === "r1" ? 1 : 2;
    return `
      <div class="trial-progress">
        <span>Pair ${pairPosition} of ${totalPairs}</span>
        <span>Interpretation ${interpretationId === "r1" ? "1" : "2"} of 2</span>
      </div>
      <p class="task-instruction">Read the context, target text, and intended meaning silently. Once you understand how the sentence should sound, record only the <strong>target text</strong>.</p>
      <div class="prompt-stack">
      <section class="prompt-section" aria-label="Context before">
        <p class="context-text">${escapeHtml(item[`context_before_${n}`])}</p>
      </section>
      <section class="target-section">
        <p class="prompt-label">Target text</p>
        <p class="target-text">${escapeHtml(item.text)}</p>
      </section>
      <section class="prompt-section" aria-label="Context after">
        <p class="context-text">${escapeHtml(item[`context_after_${n}`])}</p>
      </section>
      <section class="meaning-section">
        <p class="prompt-label">Intended meaning</p>
        <p class="meaning-text">${escapeHtml(item[`interpretation_${n}`])}</p>
      </section>
      </div>
      <p class="recording-note">${escapeHtml(note)}</p>
    `;
  }

  function recordingStimulus(item, interpretationId, pairPosition, totalPairs) {
    return promptContent(item, interpretationId, pairPosition, totalPairs, "");
  }

  let items;
  let assignmentPayload = null;
  try {
    const response = await fetch(config.itemsUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load items (${response.status})`);
    items = await response.json();
  } catch (error) {
    if (Array.isArray(config.demoItems) && config.demoItems.length > 0) {
      items = config.demoItems;
    } else {
      document.body.innerHTML = card(`
        <h1>Study unavailable</h1>
        <p>The item file could not be loaded.</p>
        <div class="status-box">${escapeHtml(error.message)}</div>
        <p class="muted">If you are reviewing a local copy, serve the folder through a local web server or use the Railway deployment.</p>
      `);
      return;
    }
  }

  try {
    const response = await fetch(config.assignmentsUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load assignments (${response.status})`);
    assignmentPayload = await response.json();
  } catch (error) {
    if (collectionActive) {
      document.body.innerHTML = card(`<h1>Study unavailable</h1><p>The participant assignments could not be loaded.</p><div class="status-box">${escapeHtml(error.message)}</div>`);
      return;
    }
  }

  let selectedItems;
  if (assignmentPayload) {
    if (collectionActive) {
      try {
        const result = await collectorRequest("condition", {
          speaker_id: speakerId,
          prolific_pid: prolific.pid,
          prolific_study_id: prolific.studyId,
          prolific_session_id: prolific.sessionId,
        });
        assignmentCondition = Number(result.condition);
        uploadToken = result.upload_token;
      } catch (error) {
        document.body.innerHTML = card(`<h1>Study unavailable</h1><p>An assignment could not be reserved.</p><div class="status-box">${escapeHtml(error.message)}</div>`);
        return;
      }
    } else {
      assignmentCondition = Number(config.demoCondition || 0);
    }

    const assignment = assignmentPayload.conditions.find((entry) => Number(entry.condition) === assignmentCondition);
    if (!assignment) {
      document.body.innerHTML = card(`<h1>Study unavailable</h1><p>Assignment ${escapeHtml(assignmentCondition)} does not exist.</p>`);
      return;
    }
    const itemMap = new Map(items.map((item) => [item.pair_id, item]));
    selectedItems = assignment.pair_ids.map((pairId) => itemMap.get(pairId));
    const missingIds = assignment.pair_ids.filter((pairId, index) => !selectedItems[index]);
    if (missingIds.length) {
      document.body.innerHTML = card(`<h1>Study unavailable</h1><p>Some assigned items are missing.</p><div class="status-box">${escapeHtml(missingIds.join(", "))}</div>`);
      return;
    }
  } else {
    selectedItems = shuffle(items).slice(0, Math.min(config.itemsPerParticipant, items.length));
  }

  if (selectedItems.length !== config.itemsPerParticipant && collectionActive) {
    document.body.innerHTML = card(`<h1>Study unavailable</h1><p>This assignment contains ${escapeHtml(selectedItems.length)} pairs instead of ${escapeHtml(config.itemsPerParticipant)}.</p>`);
    return;
  }
  itemCount = selectedItems.length;

  const jsPsych = initJsPsych({
    show_progress_bar: true,
    auto_update_progress_bar: true,
    on_finish: () => {
      const recorder = jsPsych.pluginAPI.getMicrophoneRecorder();
      recorder?.stream?.getTracks().forEach((track) => track.stop());
    },
  });

  jsPsych.data.addProperties({
    speaker_id: speakerId,
    study_id: prolific.studyId,
    session_id: prolific.sessionId,
    assignment_condition: assignmentCondition,
  });

  const timeline = [];
  const isDesktopSized = window.innerWidth >= 800 && window.innerHeight >= 600;

  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: card(`
      <h1>How does meaning sound?</h1>
      <p class="lede">You will record ${itemCount} sentence pairs, producing ${itemCount * 2} short recordings.</p>
      <ol class="steps">
        <li>Read the intended meaning and surrounding context.</li>
        <li>Record only the highlighted target sentence.</li>
        <li>Listen to your recording and rerecord it if needed.</li>
        <li>Submit the take before moving to the next prompt.</li>
      </ol>
      <p>This study requires a desktop or laptop, a working microphone, and a quiet room.</p>
      ${collectionActive ? "" : '<div class="status-box"><strong>Demo mode:</strong> recordings will not be uploaded.</div>'}
    `),
    choices: ["Continue"],
  });

  if (!isDesktopSized) {
    timeline.push({
      type: jsPsychHtmlButtonResponse,
      stimulus: card(`<h2>A larger screen is required</h2><p>Please reopen this study on a desktop or laptop with a window at least 800 × 600 pixels.</p>`, "Device check"),
      choices: ["End preview"],
      on_finish: () => jsPsych.abortExperiment("Desktop or laptop required."),
    });
  }

  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: card(`
      <div class="consent-mark" aria-hidden="true">♪</div>
      <h2>Your voice, your choice</h2>
      <p class="consent-lede">I’m 18 or older, and I agree that my recordings and demographic information may be published as part of a public benchmark used to test and improve AI models.</p>
      <p class="consent-note">My Prolific ID will not be published. My Prolific reward is the only payment I will receive.</p>
    `, "Quick consent"),
    choices: ["No thanks", "I agree"],
    css_classes: ["consent-trial"],
    data: { trial_kind: "consent" },
    on_finish: (data) => {
      data.consent = data.response === 1;
      data.consent_timestamp = new Date().toISOString();
      if (!data.consent) {
        jsPsych.abortExperiment('You chose not to participate. Please return your submission on Prolific by selecting “Stop without completing.”');
      }
    },
  });

  timeline.push({
    type: jsPsychInitializeMicrophone,
    device_select_message: card(`<h2>Select your microphone</h2><p>Choose the microphone you will use throughout the study. Your browser will ask for permission.</p>`, "Microphone setup"),
    button_label: "Use this microphone",
  });

  timeline.push({
    type: jsPsychOrukRecordingTrial,
    content: `
      <div class="trial-progress"><span>Microphone test</span><span>Not saved</span></div>
      <p class="task-instruction">Record the sentence below, then listen to it. Rerecord if your voice is not clear.</p>
      <div class="prompt-stack"><section class="target-section"><p class="prompt-label">Test sentence</p><p class="target-text">The quick brown fox jumps over the lazy dog.</p></section></div>
    `,
    maximum_duration: config.maximumRecordingMs,
    practice: true,
    data: { trial_kind: "microphone_test" },
  });

  let presentationPosition = 0;
  selectedItems.forEach((item, pairIndex) => {
    const interpretations = shuffle(["r1", "r2"]);
    interpretations.forEach((interpretationId) => {
      presentationPosition += 1;
      const position = presentationPosition;
      timeline.push({
        type: jsPsychOrukRecordingTrial,
        content: recordingStimulus(item, interpretationId, pairIndex + 1, selectedItems.length),
        maximum_duration: config.maximumRecordingMs,
        data: {
          trial_kind: "recording",
          pair_id: item.pair_id,
          interpretation_id: interpretationId,
          pair_position: pairIndex + 1,
          presentation_position: position,
        },
        on_finish: (data) => {
          const job = uploadAudio(data, item, interpretationId, position).catch((error) => {
            uploadFailures.push({ pair_id: item.pair_id, interpretation_id: interpretationId, error: error.message });
          });
          uploadJobs.push(job);
        },
      });
    });
  });

  timeline.push({
    type: jsPsychSurveyHtmlForm,
    preamble: card(`
      <h2>About you</h2>
      <p class="lede">These final questions help us understand the range of voices represented in the benchmark.</p>
    `, "Demographics"),
    html: `
      <div class="demographic-form">
        <label for="gender">Gender</label>
        <select id="gender" name="gender" required>
          <option value="" selected disabled>Select one</option>
          <option value="man">Man</option>
          <option value="woman">Woman</option>
          <option value="nonbinary">Non-binary</option>
          <option value="prefer_not_to_say">Prefer not to say</option>
        </select>

        <label for="age_range">Age range</label>
        <select id="age_range" name="age_range" required>
          <option value="" selected disabled>Select one</option>
          <option value="18_19">18–19</option>
          <option value="20s">20s</option>
          <option value="30s">30s</option>
          <option value="40s">40s</option>
          <option value="50s">50s</option>
          <option value="60_plus">60 or older</option>
        </select>

        <label for="accent">How would you describe your English accent?</label>
        <input id="accent" name="accent" type="text" maxlength="100" placeholder="For example: Southern US, Canadian, Scottish" required>

        <label for="native_english">Do you consider yourself a native speaker of English?</label>
        <select id="native_english" name="native_english" required>
          <option value="" selected disabled>Select one</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
    `,
    button_label: "Submit",
    data: { trial_kind: "demographics" },
    on_finish: (data) => {
      demographics = data.response;
    },
  });

  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: savingScreen("Finalizing your submission…", "Please do not close or refresh this window. You will continue automatically when everything is safely saved.", "Almost done"),
    choices: [],
    data: { trial_kind: "final_upload" },
    on_load: () => {
      Promise.all(uploadJobs)
        .then(() => {
          if (uploadFailures.length) {
            throw new Error(`${uploadFailures.length} recording upload${uploadFailures.length === 1 ? "" : "s"} failed after three attempts.`);
          }
          if (uploads.length !== itemCount * 2) {
            throw new Error(`Expected ${itemCount * 2} recordings but confirmed ${uploads.length}.`);
          }
          const metadata = {
            schema_version: 1,
            speaker_id: speakerId,
            assignment_condition: assignmentCondition,
            created_at: new Date().toISOString(),
            item_pairs: itemCount,
            expected_recordings: itemCount * 2,
            uploaded_recordings: uploads,
            demographics,
          };
          const admin = {
            speaker_id: speakerId,
            withdrawal_code: withdrawalCode,
            prolific_pid: prolific.pid,
            prolific_study_id: prolific.studyId,
            prolific_session_id: prolific.sessionId,
            assignment_condition: assignmentCondition,
            consented_at: jsPsych.data.get().filter({ trial_kind: "consent" }).values()[0]?.consent_timestamp,
          };
          return Promise.all([
            withRetries(() => collectorRequest("data", { speaker_id: speakerId, upload_token: uploadToken, kind: "session", filename: `session_${speakerId}.json`, data: metadata })),
            withRetries(() => collectorRequest("data", { speaker_id: speakerId, upload_token: uploadToken, kind: "admin", filename: `admin_${speakerId}.json`, data: admin })),
          ]);
        })
        .then(() => jsPsych.finishTrial({ metadata_uploaded: true }))
        .catch((error) => {
          fatalError = error.message;
          jsPsych.finishTrial({ metadata_uploaded: false, upload_error: error.message });
        });
    },
  });

  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: () => fatalError
      ? card(`<h2>Final save failed</h2><div class="status-box">${escapeHtml(fatalError)}</div><p>Please keep this page open and contact the study team through Prolific.</p>`, "Action needed")
      : card(`
          <h1>Recordings saved</h1>
          <p>All 40 recordings and study data have been saved to Railway.</p>
          <p><strong>Click “Return to Prolific” below. Prolific will submit your single completion code automatically.</strong></p>
          <p>Thank you. Save this private withdrawal code with your records:</p>
          <p><span class="code">${escapeHtml(withdrawalCode)}</span></p>
          <p class="muted">If you have questions or concerns about this study or your participation, contact busra@oruk.ai and include this code.</p>
        `, "Complete"),
    choices: () => fatalError ? ["Stay on this page"] : ["Return to Prolific"],
    on_finish: () => {
      if (fatalError) return;
      if (config.prolificCompletionCode.startsWith("REPLACE_")) return;
      window.location.assign(`https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(config.prolificCompletionCode)}`);
    },
  });

  jsPsych.run(timeline);
})();
