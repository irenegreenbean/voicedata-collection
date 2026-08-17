import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const output = path.resolve(process.argv[2] || `ambiguity-backup-${new Date().toISOString().replaceAll(":", "-")}`);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (run through `railway run`)");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await fs.mkdir(path.join(output, "audio"), { recursive: true });
await fs.mkdir(path.join(output, "metadata"), { recursive: true });

const recordings = await pool.query(`
  SELECT speaker_id, filename, mime_type, sha256, audio
  FROM ambiguity_recordings ORDER BY speaker_id, filename
`);
for (const row of recordings.rows) {
  const speakerDir = path.join(output, "audio", row.speaker_id);
  await fs.mkdir(speakerDir, { recursive: true });
  await fs.writeFile(path.join(speakerDir, row.filename), row.audio);
}

const documents = await pool.query(`
  SELECT speaker_id, kind, filename, payload
  FROM ambiguity_study_documents ORDER BY speaker_id, kind
`);
for (const row of documents.rows) {
  await fs.writeFile(path.join(output, "metadata", row.filename), `${JSON.stringify(row.payload, null, 2)}\n`);
}

const manifest = {
  created_at: new Date().toISOString(),
  recordings: recordings.rows.map(({ audio, ...row }) => ({ ...row, bytes: audio.length })),
  documents: documents.rows.map(({ payload, ...row }) => row),
};
await fs.writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await pool.end();
console.log(JSON.stringify({ output, recordings: recordings.rowCount, documents: documents.rowCount }));
