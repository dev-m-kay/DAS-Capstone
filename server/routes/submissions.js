const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const ctrl = require('../controllers/submissionController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/roles');

const ALLOWED_EXT  = new Set(['.pdf', '.docx', '.png', '.jpg', '.jpeg']);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
]);

// Files are kept in memory only long enough to insert the bytes into the
// database — we no longer write them to /uploads. This guarantees every
// server instance can serve every file (the disk-only setup meant a file
// uploaded on machine A was unreadable from machine B).
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
    return cb(null, false);
  }
  cb(null, true);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 25 * 1024 * 1024 } });

router.use(authenticate);

router.post('/',                          upload.array('files', 10), ctrl.create);
router.get('/mine',                       ctrl.getMine);
router.get('/',                           authorize('admin', 'editor'), ctrl.getAll);
router.get('/:id',                        ctrl.getOne);
router.get('/:id/files',                  ctrl.getFiles);
router.get('/:id/files/:filename',        ctrl.downloadFile);
router.get('/:id/reviewers',              ctrl.getReviewers);
router.get('/:id/rating',                 ctrl.getRating);
router.put('/:id/status',                 authorize('admin', 'editor'), ctrl.updateStatus);
router.delete('/:id',                     ctrl.delete);

module.exports = router;
