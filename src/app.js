const express = require('express');
const cors = require('cors');
const requestLogger = require('./middleware/requestLogger');

const temperatureRoutes = require('./routes/temperature');
const queryRoutes = require('./routes/query');
const deviceRoutes = require('./routes/devices');
const ruleRoutes = require('./routes/rules');
const taskRoutes = require('./routes/tasks');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'cold-chain-temp-tracker',
    version: '1.0.0'
  });
});

app.use('/api/temperature', temperatureRoutes);
app.use('/api/query', queryRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ error: '接口不存在', path: req.path });
});

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ 
    error: '服务器内部错误', 
    message: process.env.NODE_ENV === 'production' ? undefined : err.message 
  });
});

module.exports = app;
