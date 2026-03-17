const router = require('express').Router();
const userController = require('../controllers/userController');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/rbac');

router.use(authenticate);

router.get('/dashboard', userController.dashboard);
router.get('/approvers', userController.approvers);
router.get('/', requireRole('admin'), userController.list);
router.get('/:id', userController.getById);
router.put('/:id', requireRole('admin'), userController.update);

module.exports = router;
