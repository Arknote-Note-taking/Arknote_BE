const { Queue } = require('bullmq');
const IORedis = require('ioredis');

let connection = null;
let aiQueue = null;

const getConnection = () => {
  if (!connection) {
    const redisUrl = process.env.UPSTASH_REDIS_URL;
    if (!redisUrl) {
      console.warn('[Queue] UPSTASH_REDIS_URL not set — BullMQ disabled. Jobs will run synchronously.');
      return null;
    }
    connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
      retryStrategy: (times) => {
        if (times > 10) {
          console.error('[Redis] Max retries reached. Giving up.');
          return null; // stop retrying
        }
        return Math.min(times * 500, 3000); // wait up to 3s between retries
      }
    });
    connection.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });
    connection.on('connect', () => {
      console.log('[Redis] Connected to Upstash Redis');
    });
  }
  return connection;
};

const getQueue = () => {
  const conn = getConnection();
  if (!conn) return null;

  if (!aiQueue) {
    aiQueue = new Queue('ai-jobs', {
      connection: conn,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 3600 },   // keep completed jobs 1 hour
        removeOnFail: { age: 86400 }       // keep failed jobs 24 hours
      }
    });
    console.log('[Queue] BullMQ ai-jobs queue initialized');
  }
  return aiQueue;
};

/**
 * Add a job to the AI queue.
 * @param {string} type - Job type: 'generate_flashcards' | 'generate_quiz'
 * @param {object} data - Job payload
 * @returns {{ jobId: string }|null} jobId if queued, null if BullMQ disabled
 */
const enqueueAiJob = async (type, data) => {
  const queue = getQueue();
  if (!queue) return null;

  const job = await queue.add(type, data, {
    jobId: `${type}-${data.documentId || data.deckId}-${data.userId}-${Date.now()}`
  });
  console.log(`[Queue] Enqueued job: ${job.id} (type: ${type})`);
  return { jobId: job.id };
};

module.exports = { getConnection, getQueue, enqueueAiJob };
