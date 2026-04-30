const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

// --- Security middleware ---------------------------------------------------

// Helmet sets a sensible set of HTTP security headers (X-Content-Type-Options,
// X-Frame-Options, Referrer-Policy, etc.) and a strict Content Security
// Policy.
//
//   script-src 'self'         — all scripts are external; no inline <script>
//                               or onclick=" attributes anywhere in the app.
//   style-src  'self' +       — inline style="…" attributes are still used
//              'unsafe-inline'   widely in markup. CSS-attribute injection is
//                               far less dangerous than script injection;
//                               allowing it lets us keep the existing markup
//                               while still blocking script execution.
//   connect-src 'self'        — fetch() to /api/* and same-origin Socket.IO
//                               websocket upgrades (ws://localhost:3001).
//   img-src 'self' data: blob: — covers data-URI icons and blob previews.
//   frame-src 'self' blob:    — PDF preview iframe uses blob: URLs.
//   object-src 'none', base-uri 'self', form-action 'self',
//   frame-ancestors 'none'    — defense-in-depth against framing/clickjacking.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src':  ["'self'"],
      'style-src':   ["'self'", "'unsafe-inline'"],
      'img-src':     ["'self'", 'data:', 'blob:'],
      'font-src':    ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-src':   ["'self'", 'blob:'],
      'object-src':  ["'none'"],
      'base-uri':    ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS: in production, set CORS_ORIGIN to a comma-separated allow-list (e.g.
// "https://kcr.example.com"). Falling back to true (reflect request origin)
// keeps the dev workflow (`npm run frontend` on :3000) working.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : true;
app.use(cors({ origin: corsOrigin }));

app.use(express.json({ limit: '1mb' }));

// --- Static frontend -------------------------------------------------------

app.use('/css', express.static(path.join(__dirname, '..', 'css')));
app.use('/js',  express.static(path.join(__dirname, '..', 'js')));
app.use('/',    express.static(path.join(__dirname, '..', 'html')));

// NOTE: We deliberately do NOT serve /uploads as static. Submission files
// contain user content and (for reviewers) anonymized work — they are served
// only via the authenticated GET /api/submissions/:id/files/:filename route.

// --- API Routes ------------------------------------------------------------

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/submissions', require('./routes/submissions'));
app.use('/api/reviews',     require('./routes/reviews'));
app.use('/api/messages',    require('./routes/messages'));
app.use('/api/admin',       require('./routes/admin'));

// --- Error handler ---------------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

module.exports = app;
