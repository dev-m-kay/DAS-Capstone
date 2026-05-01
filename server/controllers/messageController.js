const messageModel = require('../models/Message');
const Submission = require('../models/Submission');
const User = require('../models/User');
const { canAccessSubmission } = require('../middleware/access');

// Defined locally rather than imported from the model so jest auto-mocks of
// `../models/Message` don't wipe these constants out at test time.
const STAFF_ROLES = ['admin', 'editor', 'reviewer'];
const STAFF_LOUNGE_ROOM = 'staff-lounge';

const isStaff = (user) => user && STAFF_ROLES.includes(user.role);
const isAdminOrEditor = (user) => user && (user.role === 'admin' || user.role === 'editor');
const dmRoom = (a, b) => `dm:${Math.min(Number(a), Number(b))}:${Math.max(Number(a), Number(b))}`;

// ---------- Per-submission discussion ---------------------------------------

// send a message to a submission's discussion
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
            kind: 'submission',
            submission_id: submission.submission_id,
            title: submission.title,
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

// ---------- Combined threads list (submissions + staff + DMs) ---------------

// Returns a unified list of conversations the calling user can see, each
// shaped uniformly so the frontend can render them in one list:
//   { kind, key, title, subtitle, body, created_at, sender }
//
// `kind` is one of:
//   - 'staff'       → the Staff Lounge          key='staff'
//   - 'submission'  → per-submission thread     key=submission_id (KCR-XXXX)
//   - 'dm'          → 1-on-1 direct message     key='dm:<peerUserId>'
exports.getMyThreads = async (req, res) => {
    try {
        const me = req.user;
        const threads = [];

        // 1. Staff Lounge (only for staff users, but always pinned at top)
        if (isStaff(me)) {
            const latest = await messageModel.getLatestStaffMessage();
            threads.push({
                kind: 'staff',
                key: 'staff',
                title: 'Staff Lounge',
                subtitle: 'Editors, reviewers & admins',
                body: latest ? latest.body : 'No messages yet — start the conversation!',
                created_at: latest ? latest.created_at : null,
                sender: latest
                    ? {
                        id: latest.sender_id,
                        first_name: latest.first_name,
                        last_name: latest.last_name,
                        role: latest.role,
                    }
                    : null,
                pinned: true,
            });
        }

        // 2. Submission discussions
        const subThreads = await messageModel.getThreadsForUser(me.id, me.role);
        for (const t of subThreads) {
            threads.push({
                kind: 'submission',
                key: t.submission_id,
                title: `#${t.submission_id} — ${t.title || 'Untitled'}`,
                subtitle: 'Submission discussion',
                body: t.body,
                created_at: t.created_at,
                sender: {
                    id: t.sender_id,
                    first_name: t.first_name,
                    last_name: t.last_name,
                    role: t.role,
                },
            });
        }

        // 3. Direct-message conversations
        //
        //    Everyone sees their OWN DMs as `dm:<peerId>` (sendable threads).
        //    Admins additionally see every other DM in the system as
        //    `dm:<aId>:<bId>` (read-only moderation views).
        const mine = await messageModel.getDirectMessageThreadsForUser(me.id);
        for (const t of mine) {
            const peerName = `${t.peer_first_name} ${t.peer_last_name}`.trim();
            threads.push({
                kind: 'dm',
                key: `dm:${t.peer_id}`,
                title: peerName || 'Direct message',
                subtitle: t.peer_role
                    ? t.peer_role.charAt(0).toUpperCase() + t.peer_role.slice(1)
                    : 'Direct message',
                body: t.body,
                created_at: t.created_at,
                sender: {
                    id: t.sender_id,
                    first_name: t.sender_first_name,
                    last_name: t.sender_last_name,
                    role: t.sender_role,
                },
            });
        }

        if (me.role === 'admin') {
            const all = await messageModel.getAllDirectMessageThreads();
            for (const t of all) {
                // Skip pairs the admin themselves participate in — those are
                // already in `mine` above as ordinary sendable threads.
                if (t.u_lo === me.id || t.u_hi === me.id) continue;
                const peerName = `${t.lo_first_name} ${t.lo_last_name} ↔ ${t.hi_first_name} ${t.hi_last_name}`;
                threads.push({
                    kind: 'dm',
                    key: `dm:${t.u_lo}:${t.u_hi}`,
                    title: peerName,
                    subtitle: 'Direct message (read-only)',
                    body: t.body,
                    created_at: t.created_at,
                    sender: { id: t.sender_id },
                });
            }
        }

        res.json(threads);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Something went wrong" });
    }
};

// ---------- Staff Lounge ---------------------------------------------------

exports.getStaffMessages = async (req, res) => {
    try {
        if (!isStaff(req.user)) return res.status(403).json({ error: 'Forbidden' });
        const messages = await messageModel.getStaffMessages();
        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

exports.sendStaffMessage = async (req, res) => {
    try {
        if (!isStaff(req.user)) return res.status(403).json({ error: 'Forbidden' });
        const { body } = req.body;
        if (!body || !body.trim()) {
            return res.status(400).json({ error: 'Message body cannot be empty' });
        }

        const created = await messageModel.createStaffMessage({
            sender_id: req.user.id,
            body: body.trim(),
        });
        const sender = await User.findById(req.user.id);

        const enriched = {
            ...created,
            kind: 'staff',
            key: 'staff',
            first_name: sender ? sender.first_name : null,
            last_name: sender ? sender.last_name : null,
            role: sender ? sender.role : null,
        };

        const io = req.app.get('io');
        if (io) io.to(STAFF_LOUNGE_ROOM).emit('new_message', enriched);

        res.status(201).json(enriched);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

// ---------- Direct Messages -------------------------------------------------

// Look up a user, ensuring the caller is allowed to see them as a DM peer.
async function loadDmPeer(viewer, peerId) {
    const peer = await User.findById(peerId);
    if (!peer) return { error: { status: 404, message: 'User not found' } };
    // Both sides must be staff-eligible. (Admin can DM anyone for moderation.)
    if (viewer.role !== 'admin') {
        if (!STAFF_ROLES.includes(viewer.role) || !STAFF_ROLES.includes(peer.role)) {
            return { error: { status: 403, message: 'Forbidden' } };
        }
    }
    return { peer };
}

// GET /api/messages/dm/:peerId — conversation history
exports.getDirectMessages = async (req, res) => {
    try {
        const peerId = parseInt(req.params.peerId, 10);
        if (!peerId || peerId === req.user.id) {
            return res.status(400).json({ error: 'Invalid peer id' });
        }
        const { peer, error } = await loadDmPeer(req.user, peerId);
        if (error) return res.status(error.status).json({ error: error.message });

        const messages = await messageModel.getDirectMessagesBetween(req.user.id, peer.id);
        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

// POST /api/messages/dm/:peerId — send a DM
exports.sendDirectMessage = async (req, res) => {
    try {
        const peerId = parseInt(req.params.peerId, 10);
        if (!peerId || peerId === req.user.id) {
            return res.status(400).json({ error: 'Invalid peer id' });
        }
        const { body } = req.body;
        if (!body || !body.trim()) {
            return res.status(400).json({ error: 'Message body cannot be empty' });
        }
        const { peer, error } = await loadDmPeer(req.user, peerId);
        if (error) return res.status(error.status).json({ error: error.message });

        const created = await messageModel.createDirectMessage({
            sender_id: req.user.id,
            recipient_id: peer.id,
            body: body.trim(),
        });
        const sender = await User.findById(req.user.id);

        const enriched = {
            ...created,
            kind: 'dm',
            first_name: sender ? sender.first_name : null,
            last_name: sender ? sender.last_name : null,
            role: sender ? sender.role : null,
            // Convenience flags for the client to disambiguate which thread
            // bucket this belongs in.
            peer_id: peer.id,
            peer_first_name: peer.first_name,
            peer_last_name: peer.last_name,
            peer_role: peer.role,
        };

        const io = req.app.get('io');
        if (io) io.to(dmRoom(req.user.id, peer.id)).emit('new_message', enriched);

        res.status(201).json(enriched);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

// Admin-only: read a DM between any two users (for moderation).
// GET /api/messages/dm-pair/:a/:b
exports.getDirectMessagesBetween = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const a = parseInt(req.params.a, 10);
        const b = parseInt(req.params.b, 10);
        if (!a || !b || a === b) {
            return res.status(400).json({ error: 'Invalid pair' });
        }
        const messages = await messageModel.getDirectMessagesBetween(a, b);
        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

// GET /api/messages/staff-users — list of users a staff member can DM.
//
// Returns every staff user (admin/editor/reviewer) other than the caller.
exports.listStaffUsers = async (req, res) => {
    try {
        if (!isStaff(req.user)) return res.status(403).json({ error: 'Forbidden' });
        const all = await Promise.all(
            STAFF_ROLES.map((r) => User.findByRole(r))
        );
        const flat = [].concat(...all);
        const seen = new Set();
        const list = flat
            .filter((u) => u.id !== req.user.id)
            .filter((u) => {
                if (seen.has(u.id)) return false;
                seen.add(u.id);
                return true;
            })
            .map((u) => ({
                id: u.id,
                first_name: u.first_name,
                last_name: u.last_name,
                role: u.role,
            }))
            .sort((a, b) =>
                (a.last_name || '').localeCompare(b.last_name || '') ||
                (a.first_name || '').localeCompare(b.first_name || '')
            );
        res.json(list);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

// Exposed for tests / socket layer.
exports._helpers = { dmRoom, STAFF_LOUNGE_ROOM, isStaff, isAdminOrEditor };
