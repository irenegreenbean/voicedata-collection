(async function runStudy() {
  "use strict";

  const config = window.STUDY_CONFIG;
  const url = new URL(window.location.href);
  const prolific = {
    pid: url.searchParams.get("PROLIFIC_PID") || "DEMO_PID",
    studyId: url.searchParams.get("STUDY_ID") || "DEMO_STUDY",
    sessionId: url.searchParams.get("SESSION_ID") || crypto.randomUUID(),
  };

  const randomCode = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const speakerId = randomCode("spk");
  const withdrawalCode = randomCode("wd");
  const uploads = [];
  let itemCount = 0;
  let fatalError = null;
  let demographics = null;
  let assignmentCondition = null;

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

  async function dataPipeRequest(endpoint, body) {
    if (!config.collectionEnabled) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { message: "Demo mode: upload skipped" };
    }
    if (config.dataPipeExperimentId.startsWith("REPLACE_")) {
      throw new Error("The DataPipe experiment ID has not been configured.");
    }
    const response = await fetch(`https://pipe.jspsych.org/api/${endpoint}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.message || "Upload failed");
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
    await withRetries(() => dataPipeRequest("base64", {
        experimentID: config.dataPipeExperimentId,
        filename,
        data: data.response,
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

  function privacyNoticeLink() {
    if (!config.privacyNoticeUrl) {
      return '<a href="" aria-disabled="true" onclick="return false;">Privacy notice</a>';
    }
    return `<a href="${escapeHtml(config.privacyNoticeUrl)}" target="_blank" rel="noopener noreferrer">Privacy notice</a>`;
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
        <p class="muted">If you are reviewing a local copy, serve the folder through a local web server or deploy it to GitHub Pages.</p>
      `);
      return;
    }
  }

  try {
    const response = await fetch(config.assignmentsUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load assignments (${response.status})`);
    assignmentPayload = await response.json();
  } catch (error) {
    if (config.collectionEnabled) {
      document.body.innerHTML = card(`<h1>Study unavailable</h1><p>The participant assignments could not be loaded.</p><div class="status-box">${escapeHtml(error.message)}</div>`);
      return;
    }
  }

  let selectedItems;
  if (assignmentPayload) {
    if (config.collectionEnabled) {
      try {
        const result = await dataPipeRequest("condition", { experimentID: config.dataPipeExperimentId });
        assignmentCondition = Number(result.condition);
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

  if (selectedItems.length !== config.itemsPerParticipant && config.collectionEnabled) {
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
      ${config.collectionEnabled ? "" : '<div class="status-box"><strong>Demo mode:</strong> recordings will not be uploaded.</div>'}
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
      <p class="consent-note">${privacyNoticeLink()}</p>
    `, "Quick consent"),
    choices: ["No thanks", "I agree"],
    css_classes: ["consent-trial"],
    data: { trial_kind: "consent" },
    on_finish: (data) => {
      data.consent = data.response === 1;
      data.consent_timestamp = new Date().toISOString();
      if (!data.consent) {
        if (config.prolificNoConsentUrl) {
          window.location.assign(config.prolificNoConsentUrl);
          return;
        }
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
      });
      timeline.push({
        type: jsPsychHtmlButtonResponse,
        stimulus: savingScreen("Saving recording…", "Please keep this window open. The next sentence will appear automatically."),
        choices: [],
        data: { trial_kind: "recording_upload" },
        on_load: () => {
          const data = jsPsych.data.get().filter({ trial_kind: "recording", pair_id: item.pair_id, interpretation_id: interpretationId }).last(1).values()[0];
          uploadAudio(data, item, interpretationId, position)
            .then(() => jsPsych.finishTrial({ upload_succeeded: true }))
            .catch((error) => {
              fatalError = error.message;
              jsPsych.abortExperiment("A recording could not be uploaded after three attempts. Your study has not been marked complete. Please contact the study team through Prolific.");
            });
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
      Promise.all([
        withRetries(() => dataPipeRequest("data", { experimentID: config.dataPipeExperimentId, filename: `session_${speakerId}.json`, data: JSON.stringify(metadata, null, 2) })),
        withRetries(() => dataPipeRequest("data", { experimentID: config.dataPipeExperimentId, filename: `admin_${speakerId}.json`, data: JSON.stringify(admin, null, 2) })),
      ]).then(() => jsPsych.finishTrial({ metadata_uploaded: true })).catch((error) => {
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
