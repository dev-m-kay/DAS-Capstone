const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const Submission = require('../models/Submission');
const { canAccessSubmission } = require('../middleware/access');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

// Generate a stable, traversal-proof filename for a freshly-uploaded file.
// Multer's memoryStorage doesn't assign one, and we still need a unique
// per-file identifier for the URL `/api/submissions/:id/files/:filename`.
function generateStoredFilename(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
  return unique + ext;
}

exports.create = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { title, genre, word_count, bio, notes } = req.body;

    if (!title || !genre || !bio) {
      return res.status(400).json({ error: "Title, genre, and bio are required" });
    }

    const submission_id = await Submission.nextSubmissionID();

    const filesPayload = (req.files || []).map(file => ({
      // Multer memoryStorage exposes the bytes as `file.buffer`. We keep a
      // synthetic `filename` so the existing `/files/:filename` URL keeps
      // working as a stable per-file identifier.
      filename: generateStoredFilename(file.originalname),
      original_name: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      data: file.buffer,
    }));

    const { submission } = await Submission.createWithFiles(
      { submission_id, user_id, title, genre, word_count, bio, notes },
      filesPayload
    );

    res.status(201).json({ message: "Submission created successfully", submission });

  } catch (error) {
    console.error("Create Submission Error:", error);
    // memoryStorage means there's nothing to clean up on disk on failure.
    res.status(500).json({ error: "Failed to create submission" });
  }
};

exports.getMine = async (req, res) => {
  try {
    const submissions = await Submission.findByUserId(req.user.id);
    res.json(submissions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { status, genre } = req.query;
    const submissions = await Submission.findAll({ status, genre });
    res.json(submissions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
};

exports.getOne = async (req, res) => {
  try {
    const submission = await Submission.findBySubmissionId(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (!(await canAccessSubmission(req.user, submission))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(submission);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch submission" });
  }
};

exports.getFiles = async (req, res) => {
  try {
    const submission = await Submission.findBySubmissionId(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (!(await canAccessSubmission(req.user, submission))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const files = await Submission.getFiles(submission.id);
    res.json(files);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to retrieve files" });
  }
};

// Authenticated file download. The user must (a) be logged in (handled by the
// route middleware) and (b) have access to the parent submission. The stored
// filename is matched both against the submission and the on-disk path is
// resolved with safety checks so a path-traversal value can't escape the
// uploads directory.
//
// Newly-uploaded files are served straight from `submission_files.data`
// (BYTEA) so they're available across every server instance. Rows that
// pre-date the DB-backed storage have `data = NULL`; for those we fall
// back to streaming from /uploads.
exports.downloadFile = async (req, res) => {
  try {
    const submission = await Submission.findBySubmissionId(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (!(await canAccessSubmission(req.user, submission))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Defence in depth: only allow plain filenames (no slashes, no traversal).
    const requested = path.basename(req.params.filename || '');
    if (!requested || requested !== req.params.filename) {
      return res.status(400).json({ error: "Invalid filename" });
    }

    const file = await Submission.findFileByFilename(submission.id, requested);
    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
    // Force download for non-PDF/image types to avoid HTML being executed in
    // the user's browser when previewed by name.
    const inlineSafe = ['application/pdf', 'image/png', 'image/jpeg'];
    const disposition = inlineSafe.includes(file.mimetype) ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(file.original_name)}"`
    );

    if (file.data && Buffer.isBuffer(file.data) && file.data.length > 0) {
      res.setHeader('Content-Length', file.data.length);
      return res.end(file.data);
    }

    // Legacy fallback: row was created before bytes were stored in the DB.
    const fullPath = path.join(UPLOAD_DIR, requested);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      return res.status(400).json({ error: "Invalid path" });
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: "File missing on disk" });
    }
    res.sendFile(resolved);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to download file" });
  }
};

// `DELETE /api/submissions/:id` — Removes a submission and every record
// that hangs off it (files, reviews, messages, assignments) via schema-level
// ON DELETE CASCADE.
//
// Authorization:
//   - admin: can delete any submission.
//   - submitter (the author): only while the submission is still `pending`,
//     i.e. before any review activity has happened.
//   - everyone else: 403.
exports.delete = async (req, res) => {
  try {
    const submission = await Submission.findBySubmissionId(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const role = req.user.role;
    if (role !== 'admin') {
      if (submission.user_id !== req.user.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (submission.status !== 'pending') {
        return res.status(409).json({
          error: "Only pending submissions can be deleted by their author. " +
                 "Once review has started, please contact an admin."
        });
      }
    }

    // Capture filenames so we can best-effort clean up legacy disk uploads
    // after the row goes away. New uploads live in the DB and disappear
    // automatically via ON DELETE CASCADE.
    let legacyFilenames = [];
    try {
      const files = await Submission.getFiles(submission.id);
      legacyFilenames = (files || []).map(f => f.filename);
    } catch (lookupErr) {
      console.error('delete submission: file lookup failed (continuing):', lookupErr);
    }

    await Submission.deleteById(submission.id);

    for (const filename of legacyFilenames) {
      if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) continue;
      fs.unlink(path.join(UPLOAD_DIR, filename), () => {});
    }

    res.json({ message: "Submission deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete submission" });
  }
};

// Reviewer identity is privileged information. Admins and editors can always
// see it; an assigned reviewer can see the list (so they know who else is on
// the panel); the submission's author cannot — author/reviewer anonymity is a
// core requirement of the workflow.
exports.getReviewers = async (req, res) => {
  try {
    const submission = await Submission.findBySubmissionId(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const role = req.user.role;
    let allowed = role === 'admin' || role === 'editor';
    if (!allowed) {
      const { rows } = await pool.query(
        'SELECT 1 FROM assignments WHERE submission_id = $1 AND reviewer_id = $2',
        [submission.id, req.user.id]
      );
      allowed = rows.length > 0;
    }
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    const reviewers = await Submission.getAssignedReviewers(submission.id);
    res.json(reviewers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to retrieve reviewers" });
  }
};

exports.getRating = async (req, res) => {
  try {
    const submission = await Submission.findBySubmissionId(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (!(await canAccessSubmission(req.user, submission))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const rating = await Submission.getAverageRating(submission.id);
    res.json(rating);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to retrieve rating" });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["pending", "in_review", "accepted", "rejected"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const submission = await Submission.findBySubmissionId(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const updated = await Submission.updateStatus(submission.id, status);
    res.json(updated);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update status" });
  }
};
