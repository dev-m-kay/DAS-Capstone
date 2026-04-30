/**
 * @file Role-based access-control middleware.
 *
 * Pairs with `./auth` — `authenticate` must run first so that `req.user.role`
 * is populated by the time {@link authorize} compares it to the allow-list.
 */

/**
 * Builds an Express middleware that only allows users whose `role`
 * appears in `allowedRoles` to proceed.
 *
 * @example
 *   router.get('/admin', authorize('admin', 'editor'), handler);
 *
 * @param {...string} allowedRoles  One or more role names (e.g. `'admin'`).
 * @returns {import('express').RequestHandler}
 *   Middleware that responds with `401` if `req.user` is missing,
 *   `403` if the user's role is not allowed, and otherwise calls `next()`.
 */
function authorize(...allowedRoles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    };
  }
  
  module.exports = { authorize };
