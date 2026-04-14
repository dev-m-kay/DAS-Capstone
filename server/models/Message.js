const { pool } = require('../config/db');

const messageModel = {
    // create a new message
    async create({ submission_id, sender_id, body }) {
        const { rows } = await pool.query(
            `INSERT INTO messages (submission_id, sender_id, body)
             VALUES ($1, $2, $3) RETURNING *`,
            [submission_id, sender_id, body]
        );
        return rows[0];
    },

    // Get all messages for a submission (sender name + role), oldest first
    async findBySubmission(submission_id) {
        const { rows } = await pool.query(
            `SELECT m.*, u.first_name, u.last_name, u.role
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE m.submission_id = $1
             ORDER BY m.created_at ASC`,
            [submission_id]
        );
        return rows;
    },

    // message threads for a user / the latest message for each submission
    // that they either submitted or are assigned to review
    async getThreadsForUser(user_id) {
        const { rows } = await pool.query(
            `SELECT m.*, u.first_name, u.last_name, u.role, s.title
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             JOIN submissions s ON m.submission_id = s.id
             WHERE m.id IN (
                 SELECT MAX(id)
                 FROM messages
                 GROUP BY submission_id
             )
             AND (
                 s.user_id = $1
                 OR m.submission_id IN (
                     SELECT submission_id FROM assignments WHERE reviewer_id = $1
                 )
             )
             ORDER BY m.created_at DESC`,
            [user_id]
        );
        return rows;
    }
};

module.exports = messageModel;