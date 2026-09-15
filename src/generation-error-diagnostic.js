import express from 'express';

// Expose the real generation failure in the status JSON so the UI/debugging
// can distinguish Pixazo, continuity, FFmpeg and audio failures.
const nativeGet = express.application.get;
const diagnosticRoutes = new Set([
  '/api/video/sequence/:jobId',
  '/api/video/status/:requestId'
]);

express.application.get = function diagnosticGet(route, ...handlers) {
  if (!diagnosticRoutes.has(route) || handlers.length === 0) {
    return nativeGet.call(this, route, ...handlers);
  }

  const wrapped = handlers.map((handler, index) => {
    if (index !== handlers.length - 1 || typeof handler !== 'function') return handler;

    return async (req, res, next) => {
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (body && body.status === 'ERROR' && body.detail) {
          return originalJson({ ...body, error: body.detail });
        }
        return originalJson(body);
      };
      return handler(req, res, next);
    };
  });

  return nativeGet.call(this, route, ...wrapped);
};
