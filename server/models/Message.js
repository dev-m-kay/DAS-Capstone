const { pool } = require('../config/db');

const STAFF_ROLES = ['admin', 'editor', 'reviewer'];

const messageModel = {
    // ----- Per-submission discussion (existing behaviour) -----------------

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
    // that they either submitted or are assigned to review.
    //
    // For admin / editor we return EVERY submission thread with at least one
    // message — they need full visibility for moderation. Everyone else gets
    // only threads where they are the author or an assigned reviewer.
    //
    // We deliberately return s.submission_id (the human-readable "KCR-XXXX"
    // code) as `submission_id` rather than the integer FK on m, because the
    // frontend uses this value both for URL building and for Socket.IO room
    // names (kept consistent with messageController.send).
    async getThreadsForUser(user_id, role) {
        const isPrivileged = role === 'admin' || role === 'editor';

        const baseSelect = `
            SELECT m.id, m.body, m.created_at, m.sender_id,
                   u.first_name, u.last_name, u.role,
                   s.title, s.submission_id
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            JOIN submissions s ON m.submission_id = s.id
            WHERE m.id IN (
                SELECT MAX(id)
                FROM messages
                GROUP BY submission_id
            )`;

        const sql = isPrivileged
            ? `${baseSelect} ORDER BY m.created_at DESC`
            : `${baseSelect}
               AND (
                   s.user_id = $1
                   OR m.submission_id IN (
                       SELECT submission_id FROM assignments WHERE reviewer_id = $1
                   )
               )
               ORDER BY m.created_at DESC`;

        const params = isPrivileged ? [] : [user_id];
        const { rows } = await pool.query(sql, params);
        return rows;
    },

    // ----- Staff Lounge (shared channel for admin/editor/reviewer) --------

    async createStaffMessage({ sender_id, body }) {
        const { rows } = await pool.query(
            `INSERT INTO staff_messages (sender_id, body)
             VALUES ($1, $2) RETURNING *`,
            [sender_id, body]
        );
        return rows[0];
    },

    async getStaffMessages({ limit = 200 } = {}) {
        const { rows } = await pool.query(
            `SELECT sm.id, sm.body, sm.created_at, sm.sender_id,
                    u.first_name, u.last_name, u.role
             FROM staff_messages sm
             JOIN users u ON sm.sender_id = u.id
             ORDER BY sm.created_at ASC
             LIMIT $1`,
            [limit]
        );
        return rows;
    },

    async getLatestStaffMessage() {
        const { rows } = await pool.query(
            `SELECT sm.id, sm.body, sm.created_at, sm.sender_id,
                    u.first_name, u.last_name, u.role
             FROM staff_messages sm
             JOIN users u ON sm.sender_id = u.id
             ORDER BY sm.created_at DESC
             LIMIT 1`
        );
        return rows[0] || null;
    },

    // ----- Direct Messages (1-on-1) --------------------------------------

    async createDirectMessage({ sender_id, recipient_id, body }) {
        const { rows } = await pool.query(
            `INSERT INTO direct_messages (sender_id, recipient_id, body)
             VALUES ($1, $2, $3) RETURNING *`,
            [sender_id, recipient_id, body]
        );
        return rows[0];
    },

    // Conversation between two users, oldest first.
    async getDirectMessagesBetween(userA, userB) {
        const { rows } = await pool.query(
            `SELECT dm.id, dm.body, dm.created_at, dm.sender_id, dm.recipient_id,
                    u.first_name, u.last_name, u.role
             FROM direct_messages dm
             JOIN users u ON dm.sender_id = u.id
             WHERE (dm.sender_id = $1 AND dm.recipient_id = $2)
                OR (dm.sender_id = $2 AND dm.recipient_id = $1)
             ORDER BY dm.created_at ASC`,
            [userA, userB]
        );
        return rows;
    },

    // For each peer the user has DM'd, return the latest message + that peer's
    // identity. Used to render DM threads in the messages tab.
    async getDirectMessageThreadsForUser(userId) {
        const { rows } = await pool.query(
            `WITH conv AS (
                SELECT
                    CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS peer_id,
                    id, body, created_at, sender_id, recipient_id
                FROM direct_messages
                WHERE sender_id = $1 OR recipient_id = $1
            ),
            latest AS (
                SELECT peer_id, MAX(id) AS max_id
                FROM conv
                GROUP BY peer_id
            )
            SELECT c.id, c.body, c.created_at, c.sender_id, c.recipient_id,
                   c.peer_id,
                   peer.first_name AS peer_first_name,
                   peer.last_name  AS peer_last_name,
                   peer.role       AS peer_role,
                   sender.first_name AS sender_first_name,
                   sender.last_name  AS sender_last_name,
                   sender.role       AS sender_role
            FROM conv c
            JOIN latest l ON l.peer_id = c.peer_id AND l.max_id = c.id
            JOIN users peer   ON peer.id   = c.peer_id
            JOIN users sender ON sender.id = c.sender_id
            ORDER BY c.created_at DESC`,
            [userId]
        );
        return rows;
    },

    // For admin moderation: every DM conversation in the system, latest first.
    async getAllDirectMessageThreads() {
        const { rows } = await pool.query(
            `WITH pairs AS (
                SELECT id, body, created_at, sender_id, recipient_id,
                       LEAST(sender_id, recipient_id)    AS u_lo,
                       GREATEST(sender_id, recipient_id) AS u_hi
                FROM direct_messages
            ),
            latest AS (
                SELECT u_lo, u_hi, MAX(id) AS max_id
                FROM pairs
                GROUP BY u_lo, u_hi
            )
            SELECT p.id, p.body, p.created_at, p.sender_id, p.recipient_id,
                   p.u_lo, p.u_hi,
                   ulo.first_name AS lo_first_name,
                   ulo.last_name  AS lo_last_name,
                   ulo.role       AS lo_role,
                   uhi.first_name AS hi_first_name,
                   uhi.last_name  AS hi_last_name,
                   uhi.role       AS hi_role
            FROM pairs p
            JOIN latest l ON l.u_lo = p.u_lo AND l.u_hi = p.u_hi AND l.max_id = p.id
            JOIN users ulo ON ulo.id = p.u_lo
            JOIN users uhi ON uhi.id = p.u_hi
            ORDER BY p.created_at DESC`
        );
        return rows;
    },
};

messageModel.STAFF_ROLES = STAFF_ROLES;

module.exports = messageModel;
