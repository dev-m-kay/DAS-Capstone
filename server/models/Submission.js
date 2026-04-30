const { pool } = require('../config/db');

const submissionModel = {

   async nextSubmissionID() {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next FROM submissions`
    );

    const next = parseInt(rows[0].next, 10);
    return `KCR-${String(next).padStart(4, '0')}`;
  },
  
  async create({ submission_id, user_id, title, genre, word_count = null, bio, notes = null }) {
    const { rows } = await pool.query(
      `INSERT INTO submissions (submission_id, user_id, title, genre, word_count, bio, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [submission_id, user_id, title, genre, word_count, bio, notes]
    );
    return rows[0];
  },

  async findById(id) {
    const { rows } = await pool.query(
      `SELECT s.*, u.first_name || ' ' || u.last_name AS author_name, u.email AS author_email
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1`,
      [id]
    );
    return rows[0];
  },

  async findBySubmissionId(submission_id) {
    const { rows } = await pool.query(
      `SELECT s.*, u.first_name || ' ' || u.last_name AS author_name, u.email AS author_email
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.submission_id = $1`,
      [submission_id]
    );
    return rows[0];
  },

  async findByUserId(user_id) {
    const { rows } = await pool.query(
      `SELECT * FROM submissions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user_id]
    );
    return rows;
  },

  async findAll({ status, genre } = {}) {
    let query = `SELECT * FROM submissions`;
    const values = [];
    const conditions = [];

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    if (genre) {
      values.push(genre);
      conditions.push(`genre = $${values.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(query, values);
    return rows;
  },

  async updateStatus(id, status) {
    const { rows } = await pool.query(
      `UPDATE submissions
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );
    return rows[0];
  },

  async addFile(submission_id, filename, original_name, mimetype, size) {
    const { rows } = await pool.query(
      `INSERT INTO submission_files
       (submission_id, filename, original_name, mimetype, size)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [submission_id, filename, original_name, mimetype, size]
    );
    return rows[0];
  },

  async getFiles(submission_id) {
    const { rows } = await pool.query(
      `SELECT * FROM submission_files
       WHERE submission_id = $1`,
      [submission_id]
    );
    return rows;
  },

  // Look up a single submission_files row by stored filename and confirm it
  // belongs to the given submission's integer PK. Used by the authenticated
  // file-download endpoint so a user can't fetch a file from a submission
  // they don't have access to even if they know the random filename.
  async findFileByFilename(submission_pk, filename) {
    const { rows } = await pool.query(
      `SELECT * FROM submission_files
       WHERE submission_id = $1 AND filename = $2`,
      [submission_pk, filename]
    );
    return rows[0];
  },

  // Atomic create: insert the submission row and any associated file rows in
  // one transaction so a partial failure can't leave an orphan submission.
  async createWithFiles(data, files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: subRows } = await client.query(
        `INSERT INTO submissions
           (submission_id, user_id, title, genre, word_count, bio, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING *`,
        [
          data.submission_id,
          data.user_id,
          data.title,
          data.genre,
          data.word_count ?? null,
          data.bio,
          data.notes ?? null,
        ]
      );
      const submission = subRows[0];

      const insertedFiles = [];
      for (const file of files || []) {
        const { rows: fileRows } = await client.query(
          `INSERT INTO submission_files
             (submission_id, filename, original_name, mimetype, size)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [submission.id, file.filename, file.original_name, file.mimetype, file.size]
        );
        insertedFiles.push(fileRows[0]);
      }

      await client.query('COMMIT');
      return { submission, files: insertedFiles };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getAssignedReviewers(submission_id) {
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email
       FROM assignments a
       JOIN users u ON a.reviewer_id = u.id
       WHERE a.submission_id = $1`,
      [submission_id]
    );
    return rows;
  },

  async getAverageRating(submission_id) {
    const { rows } = await pool.query(
      `SELECT ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS review_count
       FROM reviews
       WHERE submission_id = $1`,
      [submission_id]
    );
    return rows[0];
  }

};

module.exports = submissionModel;