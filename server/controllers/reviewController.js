const { pool } = require('../config/db');
const reviewModel = require('../models/Review');
const Submission = require('../models/Submission');
const User = require('../models/User');
const { canAccessSubmission } = require('../middleware/access');

// create a review
exports.create = async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { rating, comment } = req.body;

        if (rating === undefined || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        const submission = await Submission.findBySubmissionId(submissionId);
        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        // Reviewers can only review submissions they're assigned to.
        // Editors and admins can review any submission.
        if (req.user.role === 'reviewer') {
            const { rows } = await pool.query(
                'SELECT 1 FROM assignments WHERE submission_id = $1 AND reviewer_id = $2',
                [submission.id, req.user.id]
            );
            if (rows.length === 0) {
                return res.status(403).json({ error: 'You are not assigned to this submission' });
            }
        }

        const review = await reviewModel.create({
            submission_id: submission.id,
            reviewer_id: req.user.id,
            rating,
            comment
        });

        // Enrich with reviewer name to match the shape of GET /api/reviews/:submissionId
        const reviewer = await User.findById(req.user.id);
        const enriched = {
            ...review,
            first_name: reviewer ? reviewer.first_name : null,
            last_name: reviewer ? reviewer.last_name : null
        };

        res.status(201).json(enriched);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'You have already reviewed this submission' });
        }
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

// return all reviews for a submission
exports.getForSubmission = async (req, res) => {
    try {
        const submission = await Submission.findBySubmissionId(req.params.submissionId);
        if (!submission) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        if (!(await canAccessSubmission(req.user, submission))) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const reviews = await reviewModel.findBySubmission(submission.id);
        res.json(reviews);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

// return all reviews written by the logged-in reviewer
exports.getMyReviews = async (req, res) => {
    try {
        const reviews = await reviewModel.findByReviewer(req.user.id);
        res.json(reviews);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

// pending review queue: submissions assigned to me, with my own review (if any)
exports.getMyQueue = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT s.*, a.assigned_at,
                    (r.id IS NOT NULL) AS reviewed,
                    r.id AS review_id,
                    r.rating,
                    r.comment
             FROM assignments a
             JOIN submissions s ON s.id = a.submission_id
             LEFT JOIN reviews r
                ON r.submission_id = a.submission_id AND r.reviewer_id = a.reviewer_id
             WHERE a.reviewer_id = $1
             ORDER BY a.assigned_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

// update own review only
exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, comment } = req.body;

        const review = await reviewModel.findById(id);
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }
        if (review.reviewer_id !== req.user.id) {
            return res.status(403).json({ error: 'You can only edit your own reviews' });
        }
        if (rating !== undefined && (rating < 1 || rating > 5)) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        const updated = await reviewModel.update(id, { rating, comment });
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};
