const express = require('express');
const router = express.Router();
const QueryService = require('../services/queryService');

router.get('/summary/:waybill_no', (req, res) => {
  try {
    const { waybill_no } = req.params;
    const caller_system = req.headers['x-caller-system'] || req.query.caller_system;
    const ip_address = req.ip;

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

    const result = QueryService.getTemperatureRecords(waybill_no, {
      page,
      page_size,
      order,
      caller_system,
      ip_address: req.ip
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

    const alerts = QueryService.getAlertsByWaybill(waybill_no, {
      caller_system,
      ip_address: req.ip
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

module.exports = router;
