const router = require('express').Router();
const searchController = require('../controllers/searchController');
const authenticate = require('../middleware/auth');

router.use(authenticate);
router.get('/', searchController.search);

module.exports = router;
