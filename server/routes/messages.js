const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/messageController');

router.use(authenticate);

// IMPORTANT: more-specific paths must be declared BEFORE the `:submissionId`
// catch-all routes below; otherwise Express would route e.g. GET /staff to
// getForSubmission with submissionId='staff'.

// Combined threads list (submissions + Staff Lounge + DMs)
router.get('/threads',                    ctrl.getMyThreads);

// Staff Lounge
router.get('/staff',                      ctrl.getStaffMessages);
router.post('/staff',                     ctrl.sendStaffMessage);

// Staff user picker (for "New DM")
router.get('/staff-users',                ctrl.listStaffUsers);

// 1-on-1 DM (between current user and :peerId)
router.get('/dm/:peerId',                 ctrl.getDirectMessages);
router.post('/dm/:peerId',                ctrl.sendDirectMessage);

// Admin-only: read DMs between any two users
router.get('/dm-pair/:a/:b',              ctrl.getDirectMessagesBetween);

// Per-submission discussion (existing)
router.get('/:submissionId',              ctrl.getForSubmission);
router.post('/:submissionId',             ctrl.send);

module.exports = router;
