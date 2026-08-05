# Spoken Interpretation Study

A static jsPsych study designed for GitHub Pages, Prolific recruitment, and DataPipe audio uploads to a private OSF component.

## Current state

The site is in demo mode and does not upload recordings. When served through GitHub Pages, demo condition 0 loads its assigned 20 pairs. Two embedded sample items remain as a fallback when the files are opened directly. Microphone access still requires HTTPS or a localhost web server.

Before live collection:

1. Replace the provisional consent language with the company-approved version.
2. Create and activate a DataPipe experiment connected to a private US-region OSF component.
3. Enable base64 uploads and set a session limit in DataPipe.
4. Enable condition assignment with 70 conditions, numbered 0 through 69.
5. Add the DataPipe experiment ID and Prolific completion code in `config.js`.
6. Add the demographic fields to the Prolific approval request and privacy notice.
7. Pilot the complete flow on supported desktop browsers before launching.

## Important behavior

- Each pair is presented twice, once per interpretation.
- Each DataPipe condition maps to one fixed 20-pair assignment.
- Interpretation order is randomized within each pair.
- A single button starts and stops recording.
- Participants remain on the same screen for playback, rerecording, and acceptance.
- Recording prompts show context before, target text, and intended meaning. Context after is not displayed.
- Accepted recordings are uploaded immediately and removed from the in-memory jsPsych response.
- Browser-native audio is stored as WebM, OGG, or M4A depending on the recorder MIME type.
- A separate session metadata file and administration mapping file are uploaded at the end.
- The final production workflow should convert accepted audio to the desired WAV format after download.

GitHub Pages provides HTTPS, which browser microphone access requires.
