# Spoken Interpretation Voice Collection

Browser-based voice collection study for building a public benchmark that tests how AI systems interpret spoken ambiguity.

Participants read short contexts and record the same target sentence using two intended interpretations. Recruitment and payment are handled through Prolific. Recordings and study metadata are uploaded through DataPipe to a private OSF project during collection.

## Current status

The study is deployed on GitHub Pages and the complete upload workflow has been tested successfully. A full test produced 40 audio files and two JSON files in the private OSF component. Successful-completion and no-consent Prolific paths are configured. The study data and balanced assignments were regenerated from the revised source workbook on August 13, 2026.

Real uploads are currently enabled. Do not use the deployed link for casual previews, because accepted recordings will be written to OSF. The remaining launch requirement is a small Prolific pilot.

## Study design

- 280 sentence pairs
- 14 reusable assignment conditions
- 20 pairs per participant
- Two recordings per pair, one for each interpretation
- 40 accepted recordings per completed participant
- Each complete cycle of 14 participants records every pair once
- A target of 70 completed participants records every pair five times
- Pair order and interpretation order are randomized
- Desktop and laptop browsers only

The retained exclusions are `qvs_013`, `syn_008`, and `cf_010`. The revised source workbook already omits `qvs_013`; the other two are removed during generation.

The study collects age range, gender, English accent, and native English speaker status. The public benchmark will include the recordings and these demographic fields. Prolific IDs are stored separately and are not included in the public benchmark.

## Participant experience

For each interpretation, participants:

1. Read the context, target text, and intended meaning silently.
2. Record only the target text.
3. Stop the recording using the same button.
4. Listen to the recording.
5. Accept it or record it again.

Accepted recordings upload in the background while participants continue to the next prompt. The final saving screen waits for all 40 recordings and both metadata files to be confirmed before the participant can return to Prolific.

The interface requests microphone access only after consent. A microphone test recording is not uploaded.

## Repository structure

```text
index.html                  Study entry point
config.js                   Deployment and integration settings
experiment.js               Study flow, assignment, and uploads
recording-trial.js          Custom recording and playback interface
styles.css                  Participant-facing styles
stimuli/study-items.json    Included study items
stimuli/assignments.json    Balanced participant assignments
stimuli/sample-items.json   Local fallback examples
```

## Previewing the study

The upload behavior is controlled in `config.js`:

```js
collectionEnabled: false
```

Set this value to `false` for interface-only previews. Demo mode loads assignment condition 0 and does not upload recordings. Set it to `true` only for controlled upload testing and live collection.

To test the complete 20-pair flow from GitHub Pages without reserving a DataPipe condition or uploading files, add `?DEMO=1` to the study URL. For example:

```text
https://USERNAME.github.io/REPOSITORY/?DEMO=1
```

Opening `index.html` directly from the filesystem automatically forces a two-item demo preview, even when production collection is enabled. This prevents local browser file restrictions from appearing as a study error and ensures that a local preview never uploads data. Use GitHub Pages or a local web server to test the complete 20-pair production flow. Microphone behavior for direct-file previews still depends on the browser; HTTPS or localhost is the reliable option.

The current production-test configuration uses `collectionEnabled: true`.

## GitHub Pages deployment

1. Put the repository files on the `main` branch, with `index.html` at the repository root.
2. Open the repository's **Settings** page.
3. Select **Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Select the `main` branch and `/(root)` folder.
6. Save and wait for GitHub to display the public Pages URL.

GitHub Pages provides the HTTPS connection required for browser microphone access.

## DataPipe and OSF settings

The DataPipe experiment must be connected to a private OSF project. Use these settings:

- Data collection: enabled
- Base64 data collection: enabled
- Condition assignment: enabled
- Number of conditions: 14
- Session limit: 5,000 for up to approximately 100 completed participants plus testing
- Data validation: disabled
- Psych-DS metadata production: disabled

Each completed participant produces 40 audio files, one session metadata file, and one private administration file.

The 14 conditions are a fixed partition of the 280 study pairs. DataPipe cycles through conditions 0–13 repeatedly. Every complete cycle adds one recording per interpretation for every pair. Recruitment can therefore be paused after 20 participants and resumed later without creating a new DataPipe experiment.

## Prolific configuration

The Prolific study should use URL parameters so the study receives:

- `PROLIFIC_PID`
- `STUDY_ID`
- `SESSION_ID`

Create separate completion paths for:

- Successful completion
- No consent, configured as **Request a return**
- Incompatible device, configured as **Request a return**

The successful completion code and no-consent return URL are configured in `config.js`.

## Production launch checklist

- [x] Prolific completion code is configured
- [x] No-consent return URL is configured
- [x] DataPipe settings match the list above
- [x] GitHub Pages loads the study over HTTPS
- [x] One complete test session reaches the private OSF project
- [x] The test produces 40 playable audio files and two JSON files
- [ ] Condition assignment is recorded correctly
- [x] Prolific ID is absent from the public session metadata
- [ ] Withdrawal code is absent from the public session metadata
- [x] Successful completion redirects back to Prolific
- [x] Recordings upload in the background, with a final saving screen before completion
- [x] `collectionEnabled` is set to `true` after successful upload testing
- [ ] A small Prolific pilot is completed before the full launch

## Audio format

Browsers record in their supported native format, normally WebM, OGG, or M4A. Files can be converted to WAV after collection. The original filenames follow this pattern:

```text
PAIR_ID_r1_SPEAKER_ID.ext
PAIR_ID_r2_SPEAKER_ID.ext
```

## Privacy and collected data

Do not commit collected recordings, Prolific IDs, withdrawal codes, or private administration files to this repository. Collected data should remain in the private OSF project until the prepared benchmark is ready for publication.
