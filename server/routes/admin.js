/**
 * @file Admin route definitions — all endpoints mounted under `/api/admin`.
 *
 * Every route in this module is gated by two middlewares applied at the
 * router level:
 *   1. `authenticate` — requires a valid JWT and sets `req.user`.
 *   2. `authorize('admin')` — restricts access to users whose role is `admin`.
 *
 * Handlers live in `server/controllers/adminController.js`.
 *
 * Endpoint map:
 *   - `GET    /users`                                  → list all users
 *   - `PUT    /users/:id/role`                         → change a user's role
 *   - `DELETE /users/:id`                              → delete a user
 *   - `POST   /assign`                                 → assign a reviewer
 *   - `DELETE /assign/:submissionId/:reviewerId`       → remove an assignment
 *   - `GET    /workload`                               → reviewer workload stats
 *   - `PUT    /submissions/bulk-status`                → bulk status update
 *   - `GET    /export`                                 → full submissions export
 */

const router = require('express').Router();
const ctrl = require('../controllers/adminController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/roles');

router.use(authenticate);
router.use(authorize('admin'));

router.get('/users',                                    ctrl.getAllUsers);
router.put('/users/:id/role',                           ctrl.updateUserRole);
router.delete('/users/:id',                             ctrl.deleteUser);

router.post('/assign',                                  ctrl.assignReviewer);
router.delete('/assign/:submissionId/:reviewerId',      ctrl.removeAssignment);
router.get('/workload',                                 ctrl.getReviewerWorkload);

router.put('/submissions/bulk-status',                  ctrl.bulkUpdateStatus);
router.get('/export',                                   ctrl.exportData);

module.exports = router;
