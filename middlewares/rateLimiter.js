// Custom lightweight Rate Limiter middleware to prevent Brute-force & Auth abuse
const attemptsMap = new Map();

// Periodic cleanup for expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of attemptsMap.entries()) {
    if (now > data.resetTime) {
      attemptsMap.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Creates a rate limiting middleware.
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 15 minutes)
 * @param {number} options.max - Maximum number of allowed requests per window (default: 10)
 * @param {string} options.message - Error message returned when limit is reached
 */
const createRateLimiter = ({
  windowMs = 15 * 60 * 1000,
  max = 10,
  message = 'Quá nhiều yêu cầu từ địa chỉ của bạn. Vui lòng thử lại sau 15 phút!'
} = {}) => {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'unknown-ip';
    const key = `${req.path}_${ip}`;
    const now = Date.now();

    let record = attemptsMap.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      attemptsMap.set(key, record);
      return next();
    }

    record.count += 1;
    if (record.count > max) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: message,
        retryAfterSeconds: retryAfterSec
      });
    }

    next();
  };
};

module.exports = { createRateLimiter };
