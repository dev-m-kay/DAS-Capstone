const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/roles');
const reviewController = require('../controllers/reviewController');
 
router.get('/mine',              authenticate, reviewController.getMyReviews);
router.get('/:submissionId',     authenticate, reviewController.getForSubmission);
router.post('/:submissionId',    authenticate, authorize('reviewer', 'editor'), reviewController.create);
router.put('/:submissionId/:id', authenticate, authorize('reviewer', 'editor'), reviewController.update);
 
module.exports = router;

