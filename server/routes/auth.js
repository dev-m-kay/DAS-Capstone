const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

// Brute-force / abuse mitigation. Disabled in tests so supertest doesn't trip
// the limiter when running many requests in sequence.
const isTest = process.env.NODE_ENV === 'test';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 0 : 10,                 // 10 attempts per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: 'Too many login attempts. Please try again later.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTest ? 0 : 10,                 // 10 new accounts per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: 'Too many registrations from this IP. Please try again later.' },
});

router.post('/register', registerLimiter, ctrl.register);
router.post('/login',    loginLimiter,    ctrl.login);
router.get('/me',        authenticate,    ctrl.me);

module.exports = router;
