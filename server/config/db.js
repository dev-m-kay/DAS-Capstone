/**
 * @file PostgreSQL connection pool and schema bootstrap.
 *
 * Exposes a shared `pg.Pool` connected to the Supabase-hosted Postgres
 * instance specified by `DATABASE_URL`, plus an `initializeDatabase()`
 * helper that creates the application schema (tables + Row Level Security)
 * if it does not already exist.
 *
 * The pool is intentionally a module-level singleton so every controller and
 * model shares the same connection limits.
 */

const { Pool } = require('pg');
require('dotenv').config();

/**
 * Shared connection pool. SSL is required by Supabase; we disable strict
 * cert checking because Supabase's signed cert chain isn't always available
 * in CI environments.
 *
 * @type {import('pg').Pool}
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Verify connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('Connected to Supabase PostgreSQL'))
  .catch(err => {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  });

/**
 * Creates the application schema if it does not already exist.
 *
 * Idempotent — uses `CREATE TABLE IF NOT EXISTS` for every table and enables
 * Row Level Security on each. Called once at server startup from
 * `server/index.js`.
 *
 * @async
 * @returns {Promise<void>} Resolves once all DDL statements have run.
 * @throws {Error} If the underlying `pool.query` call fails.
 */
async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      first_name    TEXT    NOT NULL,
      last_name     TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'submitter'
                           CHECK(role IN ('admin','editor','reviewer','submitter')),
      bio           TEXT    DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id             SERIAL PRIMARY KEY,
      submission_id  TEXT    NOT NULL UNIQUE,
      user_id        INTEGER NOT NULL REFERENCES users(id),
      title          TEXT    NOT NULL,
      genre          TEXT    NOT NULL,
      word_count     INTEGER,
      bio            TEXT    DEFAULT '',
      notes          TEXT    DEFAULT '',
      status         TEXT    NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending','in_review','accepted','rejected')),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS submission_files (
      id             SERIAL PRIMARY KEY,
      submission_id  INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      filename       TEXT    NOT NULL,
      original_name  TEXT    NOT NULL,
      mimetype       TEXT    NOT NULL,
      size           INTEGER NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id             SERIAL PRIMARY KEY,
      submission_id  INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      reviewer_id    INTEGER NOT NULL REFERENCES users(id),
      rating         INTEGER CHECK(rating BETWEEN 1 AND 5),
      comment        TEXT    DEFAULT '',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(submission_id, reviewer_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id             SERIAL PRIMARY KEY,
      submission_id  INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      sender_id      INTEGER NOT NULL REFERENCES users(id),
      body           TEXT    NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id             SERIAL PRIMARY KEY,
      submission_id  INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      reviewer_id    INTEGER NOT NULL REFERENCES users(id),
      assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(submission_id, reviewer_id)
    );

    -- Shared "Staff Lounge" channel: a single chat that any admin / editor /
    -- reviewer can read and post to. Not tied to a submission.
    CREATE TABLE IF NOT EXISTS staff_messages (
      id          SERIAL PRIMARY KEY,
      sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body        TEXT    NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_staff_messages_created
      ON staff_messages(created_at);

    -- 1-on-1 direct messages between any two users (intended for staff↔staff
    -- communication, but the FK doesn't restrict by role — the API layer does).
    CREATE TABLE IF NOT EXISTS direct_messages (
      id            SERIAL PRIMARY KEY,
      sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body          TEXT    NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT no_self_dm CHECK (sender_id <> recipient_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dm_pair
      ON direct_messages(LEAST(sender_id, recipient_id),
                         GREATEST(sender_id, recipient_id),
                         created_at);

    -- Enable Row Level Security on all tables
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE submission_files ENABLE ROW LEVEL SECURITY;
    ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
    ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE staff_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;
  `);
}

module.exports = { pool, initializeDatabase };
