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

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    // Normalize the extension and ignore whatever the client claimed for the
    // base name so the stored filename can never contain path traversal.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, unique + ext);
  }
});

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

module.exports = router;
