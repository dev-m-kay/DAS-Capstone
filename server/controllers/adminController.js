/**
 * @file Admin controller — backs every endpoint mounted under `/api/admin`.
 *
 * Every handler in this file assumes the request has already passed through
 * `authenticate` + `authorize('admin')` (see `server/routes/admin.js`), so
 * we do not re-check permissions here.
 *
 * Handlers are written in the standard Express `(req, res) => { ... }` style
 * and respond with JSON. On unexpected errors they log and return a generic
 * `500 { error: 'Something went wrong' }`.
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const User = require('../models/User');
const Submission = require('../models/Submission');

/** Directory where Multer drops uploaded submission files. */
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

/**
 * `GET /api/admin/users` — Returns every user in the system (without
 * password hashes; see `User.findAll`).
 *
 * @async
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

/**
 * `PUT /api/admin/users/:id/role` — Updates a single user's role.
 *
 * @async
 * @param {import('express').Request}  req
 * @param {string} req.params.id     Target user id.
 * @param {Object} req.body
 * @param {('admin'|'editor'|'reviewer'|'submitter')} req.body.role  New role.
 * @param {import('express').Response} res
 * @returns {Promise<void>} `400` on invalid role, `404` if user not found.
 */
exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    const allowed = ['admin', 'editor', 'reviewer', 'submitter'];
    if (!allowed.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${allowed.join(', ')}` });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = await User.updateRole(user.id, role);
    res.json({ message: 'Role updated', user: { id: updated.id, email: updated.email, role: updated.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

/**
 * `DELETE /api/admin/users/:id` — Removes a user.
 *
 * Refuses self-deletion to prevent an admin from accidentally locking
 * themselves out of the system.
 *
 * @async
 * @param {import('express').Request}  req
 * @param {string} req.params.id  Target user id.
 * @param {import('express').Response} res
 * @returns {Promise<void>} `400` on self-delete attempt, `404` if not found.
 */
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    // Capture the on-disk filenames *before* the DB rows are deleted so we
    // can best-effort remove the uploads after the transaction commits. If
    // the lookup itself fails we don't block the delete; the worst case is
    // a few orphan files in /uploads.
    let filenames = [];
    if (typeof User.findSubmissionFilesForUser === 'function') {
      try {
        const result = await User.findSubmissionFilesForUser(user.id);
        if (Array.isArray(result)) filenames = result;
      } catch (lookupErr) {
        console.error('deleteUser: file lookup failed (continuing):', lookupErr);
      }
    }

    await User.deleteById(user.id);

    for (const filename of filenames) {
      // Defence in depth: ignore anything that smells like path traversal so
      // a corrupted DB row can never coerce us into unlinking outside /uploads.
      if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) continue;
      fs.unlink(path.join(UPLOAD_DIR, filename), () => {});
    }

    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error(err);
    if (err && err.code === '23503') {
      return res.status(409).json({
        error: 'Cannot delete user: they still have related records. Please contact a developer.',
      });
    }
    res.status(500).json({ error: 'Something went wrong' });
  }
};

/**
 * `POST /api/admin/assign` — Assigns a reviewer (or editor) to a submission.
 *
 * If the submission is currently `pending`, also bumps its status to
 * `in_review` so it appears on the reviewer's queue.
 *
 * @async
 * @param {import('express').Request}  req
 * @param {Object} req.body
 * @param {string} req.body.submission_id  Public submission id (e.g. "KCR-0001").
 * @param {number} req.body.reviewer_id    Numeric user id of the reviewer.
 * @param {import('express').Response} res
 * @returns {Promise<void>} `400` if the user is not a reviewer/editor,
 *   `404` if the submission is missing, `409` if already assigned.
 */
exports.assignReviewer = async (req, res) => {
  try {
    const { submission_id, reviewer_id } = req.body;

    const submission = await Submission.findBySubmissionId(submission_id);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const reviewer = await User.findById(reviewer_id);
    if (!reviewer || !['reviewer', 'editor'].includes(reviewer.role)) {
      return res.status(400).json({ error: 'Invalid reviewer' });
    }

    await pool.query(
      'INSERT INTO assignments (submission_id, reviewer_id) VALUES ($1, $2)',
      [submission.id, reviewer.id]
    );

    if (submission.status === 'pending') {
      await Submission.updateStatus(submission.id, 'in_review');
    }

    res.status(201).json({
      message: `${reviewer.first_name} ${reviewer.last_name} assigned to ${submission.submission_id}`
    });
  } catch (err) {
    if (err.constraint && err.constraint.includes('submission_id_reviewer_id')) {
      return res.status(409).json({ error: 'Reviewer already assigned to this submission' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

/**
 * `DELETE /api/admin/assign/:submissionId/:reviewerId` — Removes a single
 * reviewer assignment.
 *
 * @async
 * @param {import('express').Request}  req
 * @param {string} req.params.submissionId  Public submission id.
 * @param {string} req.params.reviewerId    Numeric reviewer user id.
 * @param {import('express').Response} res
 * @returns {Promise<void>} `404` if the submission or assignment is missing.
 */
exports.removeAssignment = async (req, res) => {
  try {
    const submission = await Submission.findBySubmissionId(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const { rowCount } = await pool.query(
      'DELETE FROM assignments WHERE submission_id = $1 AND reviewer_id = $2',
      [submission.id, req.params.reviewerId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    res.json({ message: 'Assignment removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

/**
 * `GET /api/admin/workload` — Returns every reviewer/editor with the number
 * of submissions currently assigned to them, ordered by busiest first.
 *
 * Used by the Admin "Reviewer Assignments" tab and the Assign Reviewer modal
 * (which displays each reviewer's current load alongside the checkbox).
 *
 * @async
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>} JSON array of
 *   `{ id, first_name, last_name, email, assigned_count }`.
 */
exports.getReviewerWorkload = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.email,
             COUNT(a.id) AS assigned_count
      FROM users u
      LEFT JOIN assignments a ON a.reviewer_id = u.id
      WHERE u.role IN ('reviewer', 'editor')
      GROUP BY u.id
      ORDER BY assigned_count DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

/**
 * `PUT /api/admin/submissions/bulk-status` — Updates the status of multiple
 * submissions in one query (used by the "Bulk Status Update" admin action).
 *
 * @async
 * @param {import('express').Request}  req
 * @param {Object}   req.body
 * @param {string[]} req.body.submission_ids  Public submission ids to update.
 * @param {('pending'|'in_review'|'accepted'|'rejected')} req.body.status
 * @param {import('express').Response} res
 * @returns {Promise<void>} `400` if `submission_ids` is empty or status is
 *   not one of the four allowed values.
 */
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { submission_ids, status } = req.body;
    const allowed = ['pending', 'in_review', 'accepted', 'rejected'];

    if (!Array.isArray(submission_ids) || submission_ids.length === 0) {
      return res.status(400).json({ error: 'submission_ids must be a non-empty array' });
    }
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    }

    const placeholders = submission_ids.map((_, i) => `$${i + 2}`).join(', ');
    await pool.query(
      `UPDATE submissions SET status = $1, updated_at = NOW() WHERE submission_id IN (${placeholders})`,
      [status, ...submission_ids]
    );

    res.json({ message: `${submission_ids.length} submission(s) updated to ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

/**
 * `GET /api/admin/export` — Returns a snapshot of every submission joined
 * with its author and aggregated review stats.
 *
 * Used both by the Admin Export modal (download a JSON dump) and by the
 * Admin Submissions table (it renders directly from this payload).
 *
 * @async
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>} JSON `{ exported_at, count, submissions: [...] }`.
 *   Each submission row includes `author_name`, `author_email`, `avg_rating`,
 *   and `review_count`.
 */
exports.exportData = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.submission_id, s.title, s.genre, s.word_count, s.status, s.created_at,
             u.first_name || ' ' || u.last_name AS author_name, u.email AS author_email,
             (SELECT AVG(rating) FROM reviews WHERE submission_id = s.id) AS avg_rating,
             (SELECT COUNT(*)    FROM reviews WHERE submission_id = s.id) AS review_count
      FROM submissions s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
    `);

    res.json({ exported_at: new Date().toISOString(), count: rows.length, submissions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};
