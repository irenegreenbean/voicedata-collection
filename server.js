import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const assignmentCount = Number(process.env.ASSIGNMENT_COUNT || 14);
const maxAudioBytes = Number(process.env.MAX_AUDIO_BYTES || 8 * 1024 * 1024);
const rentAHumanApiKey = process.env.RENTAHUMAN_API_KEY || "";
const rentAHumanBountyId = process.env.RENTAHUMAN_BOUNTY_ID || "";
const studyPublicUrl = process.env.STUDY_PUBLIC_URL || "";
const rentAHumanPollMs = Math.max(15_000, Number(process.env.RENTAHUMAN_POLL_MS || 30_000));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const root = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ambiguity_assignment_reservations (
      id BIGSERIAL PRIMARY KEY,
      speaker_id TEXT NOT NULL UNIQUE,
      condition INTEGER NOT NULL,
      prolific_pid TEXT,
      prolific_study_id TEXT,
      prolific_session_id TEXT,
      recruitment_platform TEXT,
      recruitment_worker_id TEXT,
      recruitment_task_id TEXT,
      recruitment_session_id TEXT,
      upload_token_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ambiguity_recordings (
      id BIGSERIAL PRIMARY KEY,
      speaker_id TEXT NOT NULL,
      filename TEXT NOT NULL UNIQUE,
      pair_id TEXT NOT NULL,
      interpretation_id TEXT NOT NULL,
      presentation_position INTEGER,
      mime_type TEXT NOT NULL,
      recording_duration_ms INTEGER,
      recording_attempts INTEGER,
      sha256 TEXT NOT NULL,
      audio BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ambiguity_recordings_speaker_idx ON ambiguity_recordings (speaker_id);
    CREATE TABLE IF NOT EXISTS ambiguity_study_documents (
      id BIGSERIAL PRIMARY KEY,
      speaker_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('session', 'admin')),
      filename TEXT NOT NULL UNIQUE,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (speaker_id, kind)
    );
    CREATE TABLE IF NOT EXISTS rentahuman_application_dispatches (
      application_id TEXT PRIMARY KEY,
      conversation_id TEXT,
      link_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE ambiguity_assignment_reservations ADD COLUMN IF NOT EXISTS upload_token_hash TEXT`);
  await pool.query(`ALTER TABLE ambiguity_assignment_reservations ADD COLUMN IF NOT EXISTS recruitment_platform TEXT`);
  await pool.query(`ALTER TABLE ambiguity_assignment_reservations ADD COLUMN IF NOT EXISTS recruitment_worker_id TEXT`);
  await pool.query(`ALTER TABLE ambiguity_assignment_reservations ADD COLUMN IF NOT EXISTS recruitment_task_id TEXT`);
  await pool.query(`ALTER TABLE ambiguity_assignment_reservations ADD COLUMN IF NOT EXISTS recruitment_session_id TEXT`);
}

async function rentAHumanRequest(endpoint, options = {}) {
  const response = await fetch(`https://rentahuman.ai/api${endpoint}`, {
    ...options,
    headers: {
      "X-API-Key": rentAHumanApiKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`RentAHuman ${response.status}: ${body.error || response.statusText}`);
  return body;
}

async function sendStudyLink(application) {
  if (!application.conversationId) return;
  const claimed = await pool.query(
    `INSERT INTO rentahuman_application_dispatches (application_id, conversation_id)
     VALUES ($1, $2)
     ON CONFLICT (application_id) DO NOTHING
     RETURNING application_id`,
    [application.id, application.conversationId],
  );
  if (!claimed.rowCount) return;
  try {
    await rentAHumanRequest(`/conversations/${application.conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: `You are accepted. Start the voice-recording study here: ${studyPublicUrl}\n\nUse a desktop or laptop in a quiet room, complete all 40 recordings, and submit the rah_ completion code shown at the end as your RentAHuman evidence. Do not add ?DEMO=1 to the URL.`,
      }),
    });
    await pool.query(
      `UPDATE rentahuman_application_dispatches
       SET link_sent_at = NOW(), updated_at = NOW()
       WHERE application_id = $1`,
      [application.id],
    );
    console.log(`Sent study link for RentAHuman application ${application.id}`);
  } catch (error) {
    await pool.query("DELETE FROM rentahuman_application_dispatches WHERE application_id = $1", [application.id]);
    throw error;
  }
}

let rentAHumanPollActive = false;
async function processRentAHumanApplications() {
  if (rentAHumanPollActive) return;
  rentAHumanPollActive = true;
  try {
    const payload = await rentAHumanRequest(`/bounties/${rentAHumanBountyId}/applications?sort=oldest&limit=100`);
    const applications = payload.applications || payload.data || [];
    for (const application of applications.filter((item) => item.status === "pending")) {
      await rentAHumanRequest(`/bounties/${rentAHumanBountyId}/applications/${application.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "accept" }),
      });
      console.log(`Auto-accepted RentAHuman application ${application.id}`);
    }
    const refreshed = applications.some((item) => item.status === "pending")
      ? await rentAHumanRequest(`/bounties/${rentAHumanBountyId}/applications?sort=oldest&limit=100`)
      : payload;
    for (const application of (refreshed.applications || refreshed.data || []).filter((item) => item.status === "accepted")) {
      await sendStudyLink(application);
    }
  } catch (error) {
    console.error("RentAHuman dispatcher error", error);
  } finally {
    rentAHumanPollActive = false;
  }
}

function startRentAHumanDispatcher() {
  if (!rentAHumanApiKey || !rentAHumanBountyId || !studyPublicUrl) {
    console.log("RentAHuman dispatcher disabled: configuration incomplete");
    return;
  }
  void processRentAHumanApplications();
  setInterval(() => void processRentAHumanApplications(), rentAHumanPollMs).unref();
}

function text(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.post("/api/condition", async (req, res, next) => {
  const speakerId = text(req.body?.speaker_id, 80);
  if (!speakerId) return res.status(400).json({ error: "speaker_id is required" });
  const client = await pool.connect();
  const uploadToken = crypto.randomBytes(32).toString("base64url");
  const uploadTokenHash = crypto.createHash("sha256").update(uploadToken).digest("hex");
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7319462)");
    const existing = await client.query(
      "SELECT condition FROM ambiguity_assignment_reservations WHERE speaker_id = $1",
      [speakerId],
    );
    let condition = existing.rows[0]?.condition;
    if (condition === undefined) {
      const count = await client.query("SELECT COUNT(*)::INTEGER AS count FROM ambiguity_assignment_reservations");
      condition = count.rows[0].count % assignmentCount;
      await client.query(
        `INSERT INTO ambiguity_assignment_reservations
          (speaker_id, condition, recruitment_platform, recruitment_worker_id, recruitment_task_id, recruitment_session_id, upload_token_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [speakerId, condition, text(req.body.recruitment_platform, 40), text(req.body.recruitment_worker_id, 120), text(req.body.recruitment_task_id, 120), text(req.body.recruitment_session_id, 120), uploadTokenHash],
      );
    } else {
      await client.query(
        "UPDATE ambiguity_assignment_reservations SET upload_token_hash = $2 WHERE speaker_id = $1",
        [speakerId, uploadTokenHash],
      );
    }
    await client.query("COMMIT");
    res.json({ condition, upload_token: uploadToken });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

async function authorizedSpeaker(speakerId, uploadToken) {
  if (!speakerId || !uploadToken) return false;
  const hash = crypto.createHash("sha256").update(String(uploadToken)).digest("hex");
  const result = await pool.query(
    "SELECT upload_token_hash FROM ambiguity_assignment_reservations WHERE speaker_id = $1",
    [speakerId],
  );
  const expected = result.rows[0]?.upload_token_hash;
  if (!expected || expected.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash));
}

app.post("/api/audio", async (req, res, next) => {
  const speakerId = text(req.body?.speaker_id, 80);
  const filename = text(req.body?.filename, 240);
  const pairId = text(req.body?.pair_id, 100);
  const interpretationId = text(req.body?.interpretation_id, 20);
  const mimeType = text(req.body?.mime_type, 100) || "audio/webm";
  if (!speakerId || !filename || !pairId || !interpretationId || !req.body?.data) {
    return res.status(400).json({ error: "Incomplete recording payload" });
  }
  if (!(await authorizedSpeaker(speakerId, req.body.upload_token))) {
    return res.status(403).json({ error: "Invalid upload session" });
  }
  const audio = Buffer.from(String(req.body.data), "base64");
  if (!audio.length || audio.length > maxAudioBytes) {
    return res.status(413).json({ error: "Recording is empty or too large" });
  }
  const sha256 = crypto.createHash("sha256").update(audio).digest("hex");
  try {
    await pool.query(
      `INSERT INTO ambiguity_recordings
        (speaker_id, filename, pair_id, interpretation_id, presentation_position, mime_type, recording_duration_ms, recording_attempts, sha256, audio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (filename) DO UPDATE SET
         audio = EXCLUDED.audio, sha256 = EXCLUDED.sha256,
         recording_duration_ms = EXCLUDED.recording_duration_ms,
         recording_attempts = EXCLUDED.recording_attempts`,
      [speakerId, filename, pairId, interpretationId, Number(req.body.presentation_position) || null, mimeType, Number(req.body.recording_duration_ms) || null, Number(req.body.recording_attempts) || null, sha256, audio],
    );
    res.json({ ok: true, filename, sha256 });
  } catch (error) {
    next(error);
  }
});

app.post("/api/data", async (req, res, next) => {
  const speakerId = text(req.body?.speaker_id, 80);
  const kind = text(req.body?.kind, 20);
  const filename = text(req.body?.filename, 240);
  if (!speakerId || !filename || !["session", "admin"].includes(kind) || typeof req.body?.data !== "object") {
    return res.status(400).json({ error: "Invalid study document" });
  }
  if (!(await authorizedSpeaker(speakerId, req.body.upload_token))) {
    return res.status(403).json({ error: "Invalid upload session" });
  }
  try {
    if (kind === "session") {
      const expected = Number(req.body.data.expected_recordings);
      const recorded = await pool.query(
        "SELECT COUNT(*)::INTEGER AS count FROM ambiguity_recordings WHERE speaker_id = $1",
        [speakerId],
      );
      if (!expected || recorded.rows[0].count !== expected) {
        return res.status(409).json({ error: `Expected ${expected || 0} recordings; found ${recorded.rows[0].count}` });
      }
    }
    await pool.query(
      `INSERT INTO ambiguity_study_documents (speaker_id, kind, filename, payload)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (speaker_id, kind) DO UPDATE SET
         filename = EXCLUDED.filename, payload = EXCLUDED.payload, created_at = NOW()`,
      [speakerId, kind, filename, req.body.data],
    );
    res.json({ ok: true, filename });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(root, { extensions: ["html"] }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Collector error" });
});

await initializeDatabase();
startRentAHumanDispatcher();
app.listen(port, "0.0.0.0", () => console.log(`Collector listening on ${port}`));
