const express = require('express');
const router = express.Router();
const QueryService = require('../services/queryService');

router.get('/summary/:waybill_no', (req, res) => {
  try {
    const { waybill_no } = req.params;
    const caller_system = req.headers['x-caller-system'] || req.query.caller_system;
    const ip_address = getClientIp(req);

    const summary = QueryService.getTemperatureSummary(waybill_no, {
      caller_system,
      ip_address
    });

    if (!summary) {
      return res.status(404).json({ error: '运单不存在' });
    }

    res.json({
      success: true,
      data: summary
    });
  } catch (err) {
    console.error('查询温度摘要失败:', err);
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

router.get('/records/:waybill_no', (req, res) => {
  try {
    const { waybill_no } = req.params;
    const page = parseInt(req.query.page) || 1;
    const page_size = parseInt(req.query.page_size) || 100;
    const order = req.query.order || 'asc';
    const caller_system = req.headers['x-caller-system'] || req.query.caller_system;
    const ip_address = getClientIp(req);

    const result = QueryService.getTemperatureRecords(waybill_no, {
      page,
      page_size,
      order,
      caller_system,
      ip_address
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('查询温度记录失败:', err);
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

router.get('/alerts/:waybill_no', (req, res) => {
  try {
    const { waybill_no } = req.params;
    const caller_system = req.headers['x-caller-system'] || req.query.caller_system;
    const ip_address = getClientIp(req);

    const alerts = QueryService.getAlertsByWaybill(waybill_no, {
      caller_system,
      ip_address
    });

    res.json({
      success: true,
      data: alerts
    });
  } catch (err) {
    console.error('查询告警失败:', err);
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

router.get('/report/:waybill_no', (req, res) => {
  try {
    const { waybill_no } = req.params;
    const caller_system = req.headers['x-caller-system'] || req.query.caller_system;
    const ip_address = getClientIp(req);

    const report = QueryService.getTemperatureReport(waybill_no, {
      caller_system,
      ip_address
    });

    if (!report) {
      return res.status(404).json({ error: '运单不存在' });
    }

    res.json({
      success: true,
      data: report
    });
  } catch (err) {
    console.error('生成温控报告失败:', err);
    res.status(500).json({ error: '生成报告失败', message: err.message });
  }
});

router.get('/alerts/by-role/:role', (req, res) => {
  try {
    const { role } = req.params;
    const page = parseInt(req.query.page) || 1;
    const page_size = parseInt(req.query.page_size) || 20;
    const status = req.query.status;
    const alert_level = req.query.alert_level;
    const caller_system = req.headers['x-caller-system'] || req.query.caller_system;
    const ip_address = getClientIp(req);

    if (!['driver', 'dispatcher', 'quality', 'admin'].includes(role)) {
      return res.status(400).json({ error: '角色不合法，可选值: driver, dispatcher, quality, admin' });
    }

    const result = QueryService.getAlertsByRole(role, {
      page,
      page_size,
      status,
      alert_level,
      caller_system,
      ip_address
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('按角色查询告警失败:', err);
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return realIp;
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

module.exports = router;
