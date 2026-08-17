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
  `);
  await pool.query(`ALTER TABLE ambiguity_assignment_reservations ADD COLUMN IF NOT EXISTS upload_token_hash TEXT`);
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
          (speaker_id, condition, prolific_pid, prolific_study_id, prolific_session_id, upload_token_hash)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [speakerId, condition, text(req.body.prolific_pid, 120), text(req.body.prolific_study_id, 120), text(req.body.prolific_session_id, 120), uploadTokenHash],
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
app.listen(port, "0.0.0.0", () => console.log(`Collector listening on ${port}`));
