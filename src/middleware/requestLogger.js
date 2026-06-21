function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl, ip } = req;
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    console.log(`[${new Date().toISOString()}] ${method} ${originalUrl} - ${status} - ${duration}ms - ${ip}`);
  });
  
  next();
}

module.exports = requestLogger;
