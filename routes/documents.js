const router = require('express').Router();
const multer = require('multer');
const documentController = require('../controllers/documentController');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/rbac');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

router.use(authenticate);

router.post('/upload', upload.single('file'), documentController.upload);
router.get('/', documentController.list);
router.get('/:id', documentController.getById);
router.get('/:id/download', documentController.download);
router.put('/:id', documentController.update);
router.delete('/:id', requireRole('admin'), documentController.remove);
router.post('/:id/version', upload.single('file'), documentController.uploadVersion);

module.exports = router;
