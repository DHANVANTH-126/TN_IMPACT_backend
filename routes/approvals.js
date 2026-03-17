const router = require('express').Router();
const approvalController = require('../controllers/approvalController');
const authenticate = require('../middleware/auth');

router.use(authenticate);

router.post('/', approvalController.create);
router.get('/', approvalController.list);
router.get('/my-pending', approvalController.myPending);
router.get('/:id', approvalController.getById);
router.post('/:id/steps/:stepId/action', approvalController.action);

module.exports = router;
