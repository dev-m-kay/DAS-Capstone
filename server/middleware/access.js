const { pool } = require('../config/db');

/**
 * Returns true if `user` is allowed to read or post on `submission`.
 * Rules:
 *   - admin / editor: always allowed
 *   - the submission's author: allowed
 *   - a reviewer assigned to the submission: allowed
 *   - everyone else: denied
 *
 * `submission` must include at least { id, user_id }.
 */
async function canAccessSubmission(user, submission) {
  if (!user || !submission) return false;
  if (user.role === 'admin' || user.role === 'editor') return true;
  if (submission.user_id === user.id) return true;

  const { rows } = await pool.query(
    'SELECT 1 FROM assignments WHERE submission_id = $1 AND reviewer_id = $2',
    [submission.id, user.id]
  );
  return rows.length > 0;
}

/**
 * Returns true if `user` may read or post in the *discussion* attached to
 * `submission`. Discussions are an internal, staff-only conversation about
 * the work — the submitting author is deliberately excluded so reviewers and
 * editors can speak freely without the author seeing.
 *
 * Rules:
 *   - admin / editor: always allowed
 *   - reviewer assigned to the submission: allowed
 *   - the submission's author: DENIED (even on their own submission)
 *   - everyone else: denied
 *
 * `submission` must include at least { id, user_id }.
 */
async function canDiscussSubmission(user, submission) {
  if (!user || !submission) return false;
  if (user.role === 'admin' || user.role === 'editor') return true;
  // The author of the submission must NOT see the staff discussion thread,
  // even when they own the submission.
  if (submission.user_id === user.id) return false;
  if (user.role !== 'reviewer') return false;

  const { rows } = await pool.query(
    'SELECT 1 FROM assignments WHERE submission_id = $1 AND reviewer_id = $2',
    [submission.id, user.id]
  );
  return rows.length > 0;
}

module.exports = { canAccessSubmission, canDiscussSubmission };
