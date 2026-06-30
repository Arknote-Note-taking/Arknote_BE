const { getQueue } = require('../services/jobQueue');

/**
 * GET /api/jobs/:jobId/status
 * Returns the current state of a BullMQ job.
 * States: waiting | active | completed | failed | delayed | unknown
 */
const getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    const queue = getQueue();

    if (!queue) {
      // BullMQ not available — tell frontend to poll again later
      return res.status(200).json({ status: 'unavailable', message: 'Queue not configured' });
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      return res.status(404).json({ status: 'not_found', message: 'Job not found' });
    }

    const state = await job.getState();
    const progress = job.progress || 0;

    if (state === 'completed') {
      const result = job.returnvalue;
      return res.status(200).json({
        status: 'completed',
        progress: 100,
        result
      });
    }

    if (state === 'failed') {
      return res.status(200).json({
        status: 'failed',
        progress: 0,
        error: job.failedReason || 'Job failed'
      });
    }

    return res.status(200).json({
      status: state, // 'waiting' | 'active' | 'delayed'
      progress: typeof progress === 'number' ? progress : 0
    });
  } catch (err) {
    console.error('[JobController] getJobStatus error:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
};

module.exports = { getJobStatus };
