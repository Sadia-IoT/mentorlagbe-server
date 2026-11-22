// Express 4 does not catch errors thrown inside async handlers.
// This wrapper forwards them to the central error handler in index.js.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);