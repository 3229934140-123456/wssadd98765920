const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  db: {
    path: process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'cold-chain.db')
  },
  temperature: {
    defaultReportIntervalMinutes: 5,
    alertCooldownMinutes: 10
  }
};
