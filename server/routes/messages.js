const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const messageController = require('../controllers/messageController');
 
router.get('/threads',        authenticate, messageController.getMyThreads);
router.get('/:submissionId',  authenticate, messageController.getForSubmission);
router.post('/:submissionId', authenticate, messageController.send);
 
module.exports = router;
