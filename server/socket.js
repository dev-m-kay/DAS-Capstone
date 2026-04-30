const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');
const Submission = require('./models/Submission');
const { canAccessSubmission } = require('./middleware/access');

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
        console.log(`Socket connected: ${socket.id} (user ${userId})`);

        // The room name is the submission's text code (e.g. "KCR-0001"), the
        // same value used by messageController.send. Authorize the user
        // against the submission before allowing them to join the room.
        socket.on('join_thread', async (submissionId) => {
            if (!submissionId) return;
            try {
                const submission = await Submission.findBySubmissionId(String(submissionId));
                if (!submission) return;
                if (!(await canAccessSubmission(socket.user, submission))) {
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
