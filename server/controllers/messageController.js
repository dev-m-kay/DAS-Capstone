const messageModel = require('../models/Message');
const Submission = require('../models/Submission');
const User = require('../models/User');
const { canAccessSubmission } = require('../middleware/access');

// send a message
exports.send = async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { body } = req.body;

        if (!body || !body.trim()) {
            return res.status(400).json({ error: "Message body cannot be empty" });
        }

        const submission = await Submission.findBySubmissionId(submissionId);
        if (!submission) {
            return res.status(404).json({ error: "Submission not found" });
        }
        if (!(await canAccessSubmission(req.user, submission))) {
            return res.status(403).json({ error: "Forbidden" });
        }

        const message = await messageModel.create({
            submission_id: submission.id,
            sender_id: req.user.id,
            body: body.trim()
        });

        const sender = await User.findById(req.user.id);
        // Override the integer FK with the human-readable submission_id so
        // the frontend can use the same value for URLs and for the Socket.IO
        // room name (see Message.getThreadsForUser).
        const enriched = {
            ...message,
            submission_id: submission.submission_id,
            first_name: sender ? sender.first_name : null,
            last_name: sender ? sender.last_name : null,
            role: sender ? sender.role : null
        };
        const io = req.app.get('io');
        if (io) {
            io.to(submission.submission_id).emit('new_message', enriched);
        }

        res.status(201).json(enriched);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Something went wrong" });
    }
};

// return all messages for a submission
exports.getForSubmission = async (req, res) => {
    try {
        const submission = await Submission.findBySubmissionId(req.params.submissionId);
        if (!submission) {
            return res.status(404).json({ error: "Submission not found" });
        }
        if (!(await canAccessSubmission(req.user, submission))) {
            return res.status(403).json({ error: "Forbidden" });
        }
        const messages = await messageModel.findBySubmission(submission.id);
        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Something went wrong" });
    }
};

// return the user's message threads
exports.getMyThreads = async (req, res) => {
    try {
        const threads = await messageModel.getThreadsForUser(req.user.id);
        res.json(threads);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Something went wrong" });
    }
};
