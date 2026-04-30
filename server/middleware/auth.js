/**
 * @file JWT authentication helpers.
 *
 * Exports:
 *   - `authenticate`  — Express middleware that verifies a Bearer token and
 *                       attaches the decoded payload to `req.user`.
 *   - `generateToken` — Issues a 24-hour token for a successfully
 *                       authenticated user.
 *   - `JWT_SECRET`    — The runtime secret (also imported by `socket.js` for
 *                       Socket.IO handshake auth).
 *
 * Fails fast at startup if `JWT_SECRET` is missing in non-test environments
 * to avoid signing tokens with a default, source-controlled value.
 */

const jwt = require('jsonwebtoken');

// Fail-fast: production / dev runs must always set a real JWT_SECRET so we
// never sign tokens with a value that's checked into source control. Tests
// set a value via jest.setup.js, so this only triggers on a real boot.
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'test') {
    process.env.JWT_SECRET = 'kcr-test-secret';
  } else {
    throw new Error(
      'JWT_SECRET environment variable must be set. Refusing to start with a default secret.'
    );
  }
}

/** @constant {string} Runtime JWT signing secret. */
const JWT_SECRET = process.env.JWT_SECRET;


/**
 * Express middleware that requires a valid `Authorization: Bearer <jwt>`
 * header. On success, attaches the decoded payload (`{ id, email, role }`)
 * to `req.user` and calls `next()`.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void} Calls `next()` on success; sends `401` JSON otherwise.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}


/**
 * Generates a signed JWT for an authenticated user.
 *
 * The token payload is intentionally minimal — only `id`, `email`, and
 * `role` — so we can authorize requests without re-fetching the user record
 * on every call.
 *
 * @param {Object} user        Authenticated user record.
 * @param {number} user.id     Numeric user id.
 * @param {string} user.email  Email address.
 * @param {string} user.role   `'admin' | 'editor' | 'reviewer' | 'submitter'`.
 * @returns {string} JWT signed with {@link JWT_SECRET}, valid for 24 hours.
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

module.exports = { authenticate, generateToken, JWT_SECRET };