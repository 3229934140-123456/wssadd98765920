const express = require('express');
const router = express.Router();
const QueryLogModel = require('../models/queryLog');
const AlertModel = require('../models/alert');

router.get('/query-logs', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const page_size = parseInt(req.query.page_size) || 20;
    const query_type = req.query.query_type;
    const caller_system = req.query.caller_system;
    const startTime = req.query.start_time;
    const endTime = req.query.end_time;

    const result = QueryLogModel.findAll({
      page,
      page_size,
      query_type,
      caller_system,
      startTime,
      endTime
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('查询日志查询失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/query-logs/stats', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = QueryLogModel.getStats(days);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    console.error('查询统计失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/alerts', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const page_size = parseInt(req.query.page_size) || 20;
    const alert_level = req.query.alert_level;
    const acknowledged = req.query.acknowledged;

    const result = AlertModel.findAll({
      page,
      page_size,
      alert_level,
      acknowledged: acknowledged !== undefined ? (acknowledged === 'true' || acknowledged === '1') : undefined
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('查询告警失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.post('/alerts/:id/acknowledge', (req, res) => {
  try {
    const { acknowledged_by } = req.body;
    const alert = AlertModel.acknowledge(parseInt(req.params.id), acknowledged_by);
    if (!alert) {
      return res.status(404).json({ error: '告警不存在' });
    }
    res.json({ success: true, data: alert });
  } catch (err) {
    console.error('确认告警失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

router.get('/stats', (req, res) => {
  try {
    const db = require('../db').getDb();
    
    const deviceCount = db.prepare('SELECT COUNT(*) as cnt FROM devices WHERE status = ?').get('active').cnt;
    const taskCount = db.prepare('SELECT COUNT(*) as cnt FROM transport_tasks WHERE status = ?').get('in_transit').cnt;
    const alertCount = db.prepare('SELECT COUNT(*) as cnt FROM alerts WHERE end_time IS NULL').cnt;
    const ruleCount = db.prepare('SELECT COUNT(*) as cnt FROM temp_rules').get().cnt;

    const recentAlerts = db.prepare(`
      SELECT a.*, t.waybill_no 
      FROM alerts a
      LEFT JOIN transport_tasks t ON a.waybill_no = t.waybill_no
      ORDER BY a.created_at DESC LIMIT 10
    `).all();

    res.json({
      success: true,
      data: {
        devices: {
          active_count: deviceCount,
          total_count: db.prepare('SELECT COUNT(*) as cnt FROM devices').get().cnt
        },
        tasks: {
          in_transit_count: taskCount,
          total_count: db.prepare('SELECT COUNT(*) as cnt FROM transport_tasks').get().cnt
        },
        alerts: {
          open_count: alertCount,
          total_count: db.prepare('SELECT COUNT(*) as cnt FROM alerts').get().cnt
        },
        rules: {
          count: ruleCount
        },
        recent_alerts: recentAlerts
      }
    });
  } catch (err) {
    console.error('获取统计数据失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

module.exports = router;
