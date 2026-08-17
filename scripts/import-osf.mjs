import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const source = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Usage: railway run node scripts/import-osf.mjs <downloaded-osf-directory>");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (run through `railway run`)");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const entries = await fs.readdir(source, { withFileTypes: true });
let audioCount = 0;
let documentCount = 0;

for (const entry of entries) {
  if (!entry.isFile()) continue;
  const filename = entry.name;
  const filePath = path.join(source, filename);
  const speakerMatch = filename.match(/_(spk_[a-z0-9]+)\.(webm|ogg|m4a|mp4)$/i);
  if (speakerMatch) {
    const audio = await fs.readFile(filePath);
    const parts = filename.match(/^(.+?)_(r[12])_(spk_[a-z0-9]+)\.(webm|ogg|m4a|mp4)$/i);
    if (!parts) throw new Error(`Unrecognized audio filename: ${filename}`);
    const mime = parts[4].toLowerCase() === "ogg" ? "audio/ogg" : parts[4].toLowerCase() === "m4a" || parts[4].toLowerCase() === "mp4" ? "audio/mp4" : "audio/webm";
    const sha256 = crypto.createHash("sha256").update(audio).digest("hex");
    await pool.query(
      `INSERT INTO ambiguity_recordings
        (speaker_id, filename, pair_id, interpretation_id, mime_type, sha256, audio)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (filename) DO UPDATE SET audio=EXCLUDED.audio, sha256=EXCLUDED.sha256, mime_type=EXCLUDED.mime_type`,
      [parts[3], filename, parts[1], parts[2], mime, sha256, audio],
    );
    audioCount += 1;
    continue;
  }
  if (/^(session|admin)_spk_[a-z0-9]+\.json$/i.test(filename)) {
    const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
    const [, kind, speakerId] = filename.match(/^(session|admin)_(spk_[a-z0-9]+)\.json$/i);
    await pool.query(
      `INSERT INTO ambiguity_study_documents (speaker_id, kind, filename, payload)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (speaker_id, kind) DO UPDATE SET filename=EXCLUDED.filename, payload=EXCLUDED.payload`,
      [speakerId, kind.toLowerCase(), filename, payload],
    );
    documentCount += 1;
  }
}

await pool.end();
console.log(JSON.stringify({ source, audio: audioCount, documents: documentCount }));
