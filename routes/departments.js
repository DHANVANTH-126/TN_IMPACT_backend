const router = require('express').Router();
const departmentController = require('../controllers/departmentController');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/rbac');

router.get('/public', departmentController.list);

router.use(authenticate);

router.get('/', departmentController.list);
router.get('/:id', departmentController.getById);
router.post('/', requireRole('admin'), departmentController.create);
router.put('/:id', requireRole('admin'), departmentController.update);
router.delete('/:id', requireRole('admin'), departmentController.remove);

module.exports = router;
