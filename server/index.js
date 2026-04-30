/**
 * @file Server entry point for the KCR Submission Manager.
 *
 * Loads environment variables, creates the HTTP server around the Express
 * app, attaches the Socket.IO instance for real-time messaging, runs database
 * initialization, then starts listening on `process.env.PORT` (default 3001).
 *
 * The Socket.IO `io` instance is stored on the Express app (`app.set('io', io)`)
 * so controllers — particularly the message controller — can emit events to
 * connected clients without importing `./socket` directly.
 */

require('dotenv').config();
const http = require('http');

const app = require('./app');
const { initializeDatabase } = require('./config/db');
const { setupSocket } = require('./socket');

/** @constant {number} Port the HTTP/Socket.IO server listens on. */
const PORT = process.env.PORT || 3001;

const httpServer = http.createServer(app);
const io = setupSocket(httpServer);
app.set('io', io);

initializeDatabase()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`KCR server running at http://localhost:${PORT}`);
      console.log(`Socket.IO ready for real-time messages`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  });
