# Spoken Interpretation Voice Collection

Browser-based voice collection study for building a public benchmark that tests how AI systems interpret spoken ambiguity.

Participants read short contexts and record the same target sentence using two intended interpretations. Recruitment and payment are handled through Prolific. The production app is deployed on Railway and stores recordings and study metadata directly in Railway Postgres.

## Current status

The Railway migration replaces the former GitHub Pages + DataPipe/OSF collection path. Historical records collected before the cutover remain in OSF; new sessions are written only to Railway Postgres.

Real uploads are enabled. Do not use the deployed link for casual previews, because accepted recordings will be written to Railway. Use `?DEMO=1` for non-uploading review.

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

To test the complete 20-pair flow without reserving a Railway condition or uploading files, add `?DEMO=1` to the study URL. For example:

```text
https://YOUR-RAILWAY-DOMAIN.up.railway.app/?DEMO=1
```

Opening `index.html` directly from the filesystem automatically forces a two-item demo preview, even when production collection is enabled. This prevents local browser file restrictions from appearing as a study error and ensures that a local preview never uploads data. Use Railway or a local web server to test the complete 20-pair production flow. Microphone behavior for direct-file previews still depends on the browser; HTTPS or localhost is the reliable option.

The current production-test configuration uses `collectionEnabled: true`.

## Railway deployment

1. Create a Railway project from this repository.
2. Add Railway Postgres to the project; Railway injects `DATABASE_URL` into the web service.
3. Set `ASSIGNMENT_COUNT=14` on the web service.
4. Generate a public domain and verify `/healthz` returns `{ "ok": true }`.
5. Test with `?DEMO=1`, then complete a controlled production session before updating Prolific.

## Railway storage

Each completed participant produces 40 rows in `ambiguity_recordings`, one public session document, one private administration document, and one assignment reservation. Audio is stored as `BYTEA`; metadata is stored as `JSONB`.

Recordings are stored as the exact bytes produced by the participant's browser. The collector computes and stores a SHA-256 digest for every file and does not decode, transcode, resample, or recompress audio. The production Postgres volume is 50 GB; the experiment's 15-second per-recording limit and 8 MB server-side file limit leave ample capacity for the planned collection.

The server issues a cryptographically random upload token with each assignment. Audio and metadata writes require that token, and final session metadata is accepted only after the expected number of audio files exists in Postgres.

Create an off-Railway, byte-for-byte backup with:

```bash
railway run npm run backup -- /path/to/backup-directory
```

The backup includes every original audio file, JSON metadata, and a manifest containing byte counts and SHA-256 digests. The production PostgreSQL volume also has Railway Daily, Weekly, and Monthly backup schedules enabled, plus an initial manual snapshot.

Historical DataPipe/OSF exports can be imported without recompression using:

```bash
railway run node scripts/import-osf.mjs /path/to/downloaded-osf-component
```

The 14 conditions are a fixed partition of the 280 study pairs. The Railway collector assigns conditions 0–13 transactionally and idempotently. Every complete cycle adds one recording per interpretation for every pair.

## Prolific configuration

The Prolific study should use URL parameters so the study receives:

- `PROLIFIC_PID`
- `STUDY_ID`
- `SESSION_ID`

The production study has exactly one completion path. After Railway confirms all
40 recordings and both metadata documents, the experiment redirects to Prolific
with completion code `CJSEBAX0`. Participants who decline consent are instructed
to return the study without completing it and are not shown a completion code.

## Production launch checklist

- [x] Prolific completion code is configured
- [x] The Prolific draft has exactly one completion path
- [x] Railway Postgres is attached and `/healthz` succeeds
- [x] Railway loads the study over HTTPS
- [x] One complete test session reaches Railway Postgres
- [x] The test produces 40 playable audio files and two JSON files
- [x] Condition assignment is recorded correctly
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

Do not commit collected recordings, Prolific IDs, withdrawal codes, database exports, or private administration files to this repository. Keep historical OSF data and new Railway data private until the prepared benchmark is ready for publication.
