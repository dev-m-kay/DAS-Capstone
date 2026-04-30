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

const JWT_SECRET = process.env.JWT_SECRET;

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

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

module.exports = { authenticate, generateToken, JWT_SECRET };