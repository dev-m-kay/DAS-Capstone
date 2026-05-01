const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');
const Submission = require('./models/Submission');
const User = require('./models/User');
const { canDiscussSubmission } = require('./middleware/access');
const { _helpers } = require('./controllers/messageController');

const STAFF_ROLES = ['admin', 'editor', 'reviewer'];
const { STAFF_LOUNGE_ROOM, dmRoom } = _helpers;

function setupSocket(httpServer) {
    const corsOrigin = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
        : true;

    const io = new Server(httpServer, {
        cors: {
            origin: corsOrigin,
            methods: ['GET', 'POST']
        }
    });

    // JWT handshake authentication
    io.use((socket, next) => {
        const token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication required'));
        try {
            socket.user = jwt.verify(token, JWT_SECRET);
            next();
        } catch {
            next(new Error('Invalid or expired token'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.user && socket.user.id;
        const userRole = socket.user && socket.user.role;
        console.log(`Socket connected: ${socket.id} (user ${userId})`);

        // Staff users automatically join the Staff Lounge so they receive
        // broadcasts without an explicit join.
        if (STAFF_ROLES.includes(userRole)) {
            socket.join(STAFF_LOUNGE_ROOM);
        }

        // Per-submission discussion thread.
        // The room name is the submission's text code (e.g. "KCR-0001"), the
        // same value used by messageController.send. Authorize the user
        // against the submission before allowing them to join.
        socket.on('join_thread', async (submissionId) => {
            if (!submissionId) return;
            try {
                const submission = await Submission.findBySubmissionId(String(submissionId));
                if (!submission) return;
                if (!(await canDiscussSubmission(socket.user, submission))) {
                    socket.emit('error', { message: 'Forbidden' });
                    return;
                }
                socket.join(String(submissionId));
                console.log(`Client ${socket.id} joined thread ${submissionId}`);
            } catch (err) {
                console.error('join_thread auth error:', err);
            }
        });

        socket.on('leave_thread', (submissionId) => {
            if (!submissionId) return;
            socket.leave(String(submissionId));
            console.log(`Client ${socket.id} left thread ${submissionId}`);
        });

        // 1-on-1 DM room. Either participant (or an admin moderating) can
        // join. The room name is canonicalised so both sides share it.
        socket.on('join_dm', async (peerId) => {
            const peer = parseInt(peerId, 10);
            if (!peer || peer === socket.user.id) return;
            try {
                if (socket.user.role !== 'admin') {
                    if (!STAFF_ROLES.includes(socket.user.role)) return;
                    const peerUser = await User.findById(peer);
                    if (!peerUser || !STAFF_ROLES.includes(peerUser.role)) return;
                }
                socket.join(dmRoom(socket.user.id, peer));
            } catch (err) {
                console.error('join_dm auth error:', err);
            }
        });

        socket.on('leave_dm', (peerId) => {
            const peer = parseInt(peerId, 10);
            if (!peer || peer === socket.user.id) return;
            socket.leave(dmRoom(socket.user.id, peer));
        });

        // Admin moderation: subscribe to a DM between two arbitrary users.
        socket.on('join_dm_pair', async (a, b) => {
            if (socket.user.role !== 'admin') return;
            const ai = parseInt(a, 10);
            const bi = parseInt(b, 10);
            if (!ai || !bi || ai === bi) return;
            socket.join(dmRoom(ai, bi));
        });

        socket.on('error', (err) => {
            console.error(`Socket ${socket.id} error:`, err);
        });

        socket.on('disconnect', () => {
            console.log(`Client disconnected: ${socket.id}`);
        });
    });

    return io;
}

module.exports = { setupSocket };
