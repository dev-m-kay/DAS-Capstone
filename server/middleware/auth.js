const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'kcr-dev-secret-change-in-production';


/**
 * Middleware for user authentication
 *
 * @param {Object} req Express request object
 * @param {Object} res Express response object
 * @param {Function} next Express next middleware function
 * @returns {void|object} Calls next() on success, returns 401 on failure. 
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
 * Generates a JWT token for authenticated users
 *
 * @param {Object} user User Object containing authentication data 
 * @returns {String} JWT token valid for 24 hours
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

module.exports = { authenticate, generateToken, JWT_SECRET };