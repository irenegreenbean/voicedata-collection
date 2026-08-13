window.STUDY_CONFIG = {
  studyTitle: "Spoken Interpretation Study",
  itemsUrl: "stimuli/study-items.json",
  assignmentsUrl: "stimuli/assignments.json",
  itemsPerParticipant: 20,
  maximumRecordingMs: 15000,
  demoCondition: 0,

  // Replace these values before collecting real data.
  dataPipeExperimentId: "Hr9WPfedjGzI",
  prolificCompletionCode: "CJSEBAX0",
  prolificNoConsentUrl: "https://app.prolific.com/submissions/complete?cc=C1AGMO6R",
  // Real uploads are enabled for the controlled end-to-end test.
  // Do not recruit participants until the OSF output has been verified.
  collectionEnabled: true,

  // Used only when the demo is opened directly from a local file and the browser
  // blocks loading stimuli/sample-items.json. GitHub Pages uses itemsUrl above.
  demoItems: [
    {
      pair_id: "qvs_013",
      source: "coca/text_spok",
      ambiguity_type: "question_vs_statement",
      text: "He hasn't really been convicted of anything yet.",
      interpretation_1: "The speaker asks whether he has not yet been convicted of anything.",
      context_before_1: "Everyone is already speaking about him as though the case were finished.",
      context_after_1: "No, the trial has not even begun.",
      interpretation_2: "The speaker states that he has not yet been convicted of anything.",
      context_before_2: "The allegations are serious, but the legal process is still underway.",
      context_after_2: "Calling him guilty at this stage would be premature.",
      linguistic_phenomenon: "Declarative question vs statement",
    },
    {
      pair_id: "demo_002",
      source: "demo",
      ambiguity_type: "focus",
      text: "Jordan ordered the green notebook.",
      interpretation_1: "The speaker contrasts Jordan with another possible person.",
      context_before_1: "I thought Casey placed the order.",
      context_after_1: "No, it was Jordan who placed it.",
      interpretation_2: "The speaker contrasts the green notebook with another notebook.",
      context_before_2: "I thought Jordan ordered the blue notebook.",
      context_after_2: "No, the green one was selected.",
      linguistic_phenomenon: "Contrastive focus",
    },
  ],
};
