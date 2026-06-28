const { verifyToken } = require('../utils/tokens');

/**
 * authMiddleware — verifies the access token on protected API routes.
 *
 * This replaces the fake-auth version. It now verifies a REAL signed JWT using
 * the same `verifyToken` name the rest of the codebase imports, so socket auth
 * and any existing protected routes keep working unchanged.
 *
 * On success it attaches the decoded payload to req.user as { id, name, role }.
 * The server treats this token as the authority on identity for the request —
 * the client cannot override it.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * requireRole — gate a route to specific roles. Use AFTER authMiddleware.
 *
 * This is the SERVER-SIDE enforcement of role-based access control. The
 * frontend route guards are UX only; this is the real boundary. Jovan's admin
 * routes (Workstream 5) should mount as:
 *
 *     router.use(authMiddleware, requireRole('admin'));
 *
 * so every admin action is provably restricted to admin tokens regardless of
 * what the client sends.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
