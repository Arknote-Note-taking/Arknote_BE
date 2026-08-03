const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const { getJobStatus } = require('../controllers/jobController');

/**
 * @swagger
 * tags:
 *   name: Jobs
 *   description: Background job status tracking
 */

router.use(requireAuth);

/**
 * @swagger
 * /api/jobs/{jobId}/status:
 *   get:
 *     summary: Get background job processing status
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job status details
 */
router.get('/:jobId/status', getJobStatus);

module.exports = router;
