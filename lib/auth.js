function authMiddleware(req, res, next) {
  if (process.env.NODE_ENV === 'development') {
    req.user = {
      email: process.env.DEV_USER_EMAIL || 'dev@localhost',
      name: process.env.DEV_USER_NAME || 'Dev'
    };
    return next();
  }
  const email = req.headers['remote-email'];
  if (!email) return res.status(401).send('Not authenticated');
  req.user = {
    email,
    name: req.headers['remote-name'] || email.split('@')[0]
  };
  next();
}

module.exports = authMiddleware;
