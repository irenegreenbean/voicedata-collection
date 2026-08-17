import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await pool.query(`
    SELECT
      payload->>'recruitment_worker_id' AS rentahuman_worker_id,
      payload->>'completion_code' AS completion_code,
      speaker_id,
      created_at
    FROM ambiguity_study_documents
    WHERE kind = 'admin'
      AND payload->>'recruitment_platform' = 'rentahuman'
      AND COALESCE(payload->>'completion_code', '') <> ''
    ORDER BY created_at DESC
  `);
  process.stdout.write(`${JSON.stringify(result.rows, null, 2)}\n`);
} finally {
  await pool.end();
}
