const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const { getJobStatus } = require('../controllers/jobController');

router.use(requireAuth);
router.get('/:jobId/status', getJobStatus);

module.exports = router;
