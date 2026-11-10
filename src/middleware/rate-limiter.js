/**
 * In-Memory Sliding Window Rate Limiter
 * Protects login and sensitive authentication endpoints from brute force.
 */

const rateLimitMap = new Map();

function rateLimit({ windowMs = 60000, maxRequests = 10, message = 'Too many requests. Please try again later.' } = {}) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const key = `${req.path}:${ip}`;
    const now = Date.now();

    const record = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 1;
      record.resetAt = now + windowMs;
    } else {
      record.count += 1;
    }

    rateLimitMap.set(key, record);

    if (record.count > maxRequests) {
      const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds,
      });
    }

    next();
  };
}

// Cleanup stale rate limit records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

module.exports = { rateLimit };

