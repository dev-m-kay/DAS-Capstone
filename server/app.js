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
// Notes:
//   - script-src 'self'  — all scripts are external; no inline <script> or
//                          onclick= attributes anywhere in the app.
//   - style-src adds 'unsafe-inline' (existing style="…" attributes in markup;
//     CSS-attribute injection is far less dangerous than script injection) plus
//     fonts.googleapis.com so the Inter font CSS loads.
//   - font-src allows fonts.gstatic.com so the Inter font files load.
//   - connect-src lists ws:/wss: explicitly because some browsers don't treat
//     'self' as covering WebSocket origins; this is what Socket.IO needs.
//   - upgrade-insecure-requests is disabled (set to null) — without that,
//     helmet's default forces every request to https, which breaks local
//     development on http://localhost:3001 in some browsers.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src':  ["'self'"],
      'style-src':   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'img-src':     ["'self'", 'data:', 'blob:'],
      'font-src':    ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'connect-src': ["'self'", 'ws:', 'wss:'],
      'frame-src':   ["'self'", 'blob:'],
      'object-src':  ["'none'"],
      'base-uri':    ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': null,
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

// Always revalidate HTML/JS/CSS so a hard refresh isn't required after a
// frontend deploy. ETags are still set, so unchanged files return 304.
const noCache = (res) => {
  res.setHeader('Cache-Control', 'no-cache');
};
const staticOpts = { etag: true, lastModified: true, setHeaders: noCache };

app.use('/css', express.static(path.join(__dirname, '..', 'css'), staticOpts));
app.use('/js',  express.static(path.join(__dirname, '..', 'js'),  staticOpts));

// Vendored client-side libraries served from node_modules. We only expose
// individual files we explicitly need on the client (mammoth for DOCX
// previews) — we do NOT make node_modules itself reachable.
const mammothBrowser = require.resolve('mammoth/mammoth.browser.min.js');
app.get('/js/lib/mammoth.browser.min.js', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(mammothBrowser);
});

app.use('/',    express.static(path.join(__dirname, '..', 'html'), staticOpts));

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
