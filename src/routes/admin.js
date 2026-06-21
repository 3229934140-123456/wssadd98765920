const express = require('express');
const router = express.Router();
const QueryLogModel = require('../models/queryLog');
const AlertModel = require('../models/alert');
const AlertHandlingModel = require('../models/alertHandling');
const QueryService = require('../services/queryService');

function _handleHandlingError(res, err) {
  const code = err.code;
  if (code === 'UNKNOWN_ROLE') {
    return res.status(400).json({ success: false, error: err.message, code });
  }
  if (code === 'ROLE_PERMISSION_DENIED') {
    return res.status(403).json({
      success: false,
      error: err.message,
      code,
      allowed_actions: err.allowed_actions
    });
  }
  if (code === 'ALERT_NOT_FOUND') {
    return res.status(404).json({ success: false, error: err.message, code });
  }
  if (code === 'MISSING_TARGET_ROLE') {
    return res.status(400).json({ success: false, error: err.message, code });
  }
  if (code === 'NOT_ASSIGNED') {
    return res.status(409).json({
      success: false,
      error: err.message,
      code,
      current_assignee: err.current_assignee
    });
  }
  console.error('告警处置失败:', err);
  return res.status(500).json({ success: false, error: '操作失败', message: err.message });
}

router.get('/query-logs', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const page_size = parseInt(req.query.page_size) || 20;
    const query_type = req.query.query_type;
    const caller_system = req.query.caller_system;
    const waybill_no = req.query.waybill_no;
    const startTime = req.query.start_time;
    const endTime = req.query.end_time;

    const result = QueryLogModel.findAll({
      page,
      page_size,
      query_type,
      caller_system,
      waybill_no,
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

router.get('/query-logs/stats/by-caller', (req, res) => {
  try {
    const startTime = req.query.start_time;
    const endTime = req.query.end_time;
    
    const stats = QueryLogModel.getStatsByCaller({ startTime, endTime });
    
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    console.error('调用方统计失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/query-logs/stats/by-type', (req, res) => {
  try {
    const startTime = req.query.start_time;
    const endTime = req.query.end_time;
    
    const stats = QueryLogModel.getStatsByType({ startTime, endTime });
    
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    console.error('查询类型统计失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/query-logs/stats/summary', (req, res) => {
  try {
    const startTime = req.query.start_time;
    const endTime = req.query.end_time;
    
    const summary = QueryLogModel.getSummary({ startTime, endTime });
    const topCallers = QueryLogModel.getTopCallers({ limit: 10, startTime, endTime });
    const byType = QueryLogModel.getStatsByType({ startTime, endTime });
    
    res.json({
      success: true,
      data: {
        summary,
        top_callers: topCallers,
        by_type: byType
      }
    });
  } catch (err) {
    console.error('查询日志汇总失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/query-logs/dashboard', (req, res) => {
  try {
    const filters = {
      page: parseInt(req.query.page) || 1,
      page_size: parseInt(req.query.page_size) || 20,
      query_type: req.query.query_type,
      caller_system: req.query.caller_system,
      waybill_no: req.query.waybill_no,
      startTime: req.query.start_time,
      endTime: req.query.end_time
    };
    
    const dashboard = QueryLogModel.getDashboard(filters);
    
    res.json({
      success: true,
      filters: {
        query_type: filters.query_type || null,
        caller_system: filters.caller_system || null,
        waybill_no: filters.waybill_no || null,
        start_time: filters.startTime || null,
        end_time: filters.endTime || null
      },
      data: dashboard
    });
  } catch (err) {
    console.error('查询日志Dashboard失败:', err);
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

router.get('/alerts', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const page_size = parseInt(req.query.page_size) || 20;
    const alert_level = req.query.alert_level;
    const acknowledged = req.query.acknowledged;
    const status = req.query.status;
    const role = req.query.role;
    const startTime = req.query.start_time;
    const endTime = req.query.end_time;

    let result;
    if (role) {
      result = AlertModel.findByRole(role, {
        page,
        page_size,
        status,
        alert_level,
        startTime,
        endTime
      });
    } else {
      result = AlertModel.findAll({
        page,
        page_size,
        alert_level,
        status,
        startTime,
        endTime,
        acknowledged: acknowledged !== undefined ? (acknowledged === 'true' || acknowledged === '1') : undefined
      });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('查询告警失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/alerts/:id', (req, res) => {
  try {
    const alert = AlertModel.findById(parseInt(req.params.id));
    if (!alert) {
      return res.status(404).json({ error: '告警不存在' });
    }

    const handlingSummary = AlertHandlingModel.getHandlingSummary(alert.id);

    res.json({
      success: true,
      data: {
        ...alert,
        notify_roles: alert.notify_roles ? alert.notify_roles.split(',') : [],
        handling: handlingSummary
      }
    });
  } catch (err) {
    console.error('查询告警详情失败:', err);
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

router.post('/alerts/:id/process', (req, res) => {
  try {
    const { handler_role, handler_name, result, remark } = req.body;
    const alertId = parseInt(req.params.id);
    
    const alert = AlertModel.findById(alertId);
    if (!alert) {
      return res.status(404).json({ error: '告警不存在' });
    }

    const handling = AlertHandlingModel.processAlert(alertId, {
      handler_role,
      handler_name,
      result,
      remark
    });

    res.json({
      success: true,
      data: {
        handling,
        handling_summary: AlertHandlingModel.getHandlingSummary(alertId)
      }
    });
  } catch (err) {
    _handleHandlingError(res, err);
  }
});

router.post('/alerts/:id/escalate', (req, res) => {
  try {
    const { handler_role, handler_name, target_role, remark } = req.body;
    const alertId = parseInt(req.params.id);
    
    const alert = AlertModel.findById(alertId);
    if (!alert) {
      return res.status(404).json({ error: '告警不存在' });
    }

    if (!target_role) {
      return res.status(400).json({ error: '升级必须指定 target_role' });
    }

    const handling = AlertHandlingModel.escalateAlert(alertId, {
      handler_role,
      handler_name,
      target_role,
      remark
    });

    res.json({
      success: true,
      data: {
        handling,
        handling_summary: AlertHandlingModel.getHandlingSummary(alertId)
      }
    });
  } catch (err) {
    _handleHandlingError(res, err);
  }
});

router.post('/alerts/:id/reassign', (req, res) => {
  try {
    const { handler_role, handler_name, target_role, remark } = req.body;
    const alertId = parseInt(req.params.id);
    
    const alert = AlertModel.findById(alertId);
    if (!alert) {
      return res.status(404).json({ error: '告警不存在' });
    }

    if (!target_role) {
      return res.status(400).json({ error: '转派必须指定 target_role' });
    }

    const handling = AlertHandlingModel.reassignAlert(alertId, {
      handler_role,
      handler_name,
      target_role,
      remark
    });

    res.json({
      success: true,
      data: {
        handling,
        handling_summary: AlertHandlingModel.getHandlingSummary(alertId)
      }
    });
  } catch (err) {
    _handleHandlingError(res, err);
  }
});

router.post('/alerts/:id/conclude', (req, res) => {
  try {
    const { handler_role, handler_name, result, remark } = req.body;
    const alertId = parseInt(req.params.id);
    
    const alert = AlertModel.findById(alertId);
    if (!alert) {
      return res.status(404).json({ error: '告警不存在' });
    }

    const handling = AlertHandlingModel.concludeAlert(alertId, {
      handler_role,
      handler_name,
      result,
      remark
    });

    res.json({
      success: true,
      data: {
        handling,
        handling_summary: AlertHandlingModel.getHandlingSummary(alertId)
      }
    });
  } catch (err) {
    _handleHandlingError(res, err);
  }
});

router.get('/stats', (req, res) => {
  try {
    const db = require('../db').getDb();
    
    const deviceCount = db.prepare('SELECT COUNT(*) as cnt FROM devices WHERE status = ?').get('active').cnt;
    const taskCount = db.prepare('SELECT COUNT(*) as cnt FROM transport_tasks WHERE status = ?').get('in_transit').cnt;
    const alertCount = db.prepare('SELECT COUNT(*) as cnt FROM alerts WHERE end_time IS NULL').cnt;
    const ruleCount = db.prepare('SELECT COUNT(*) as cnt FROM temp_rules').get().cnt;

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
        }
      }
    });
  } catch (err) {
    console.error('获取统计数据失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/timeout-board', (req, res) => {
  try {
    const waybill_no = req.query.waybill_no || null;
    const role = req.query.role || null;
    const timeout_level = req.query.timeout_level || null;
    const page = parseInt(req.query.page) || 1;
    const page_size = parseInt(req.query.page_size) || 20;

    const result = QueryService.getTimeoutBoard({
      waybill_no,
      role,
      timeout_level,
      page,
      page_size
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('获取超时看板失败:', err);
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

router.get('/audit/timeline', (req, res) => {
  try {
    const waybill_no = req.query.waybill_no;
    const report_no = req.query.report_no;
    const caller_system = req.headers['x-caller-system'] || 'admin-console';
    const ip_address = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.headers['x-real-ip'] || req.ip || req.connection?.remoteAddress || 'unknown';

    if (!waybill_no && !report_no) {
      return res.status(400).json({ error: '必须提供 waybill_no 或 report_no' });
    }

    const timeline = QueryService.getAuditTimeline({
      waybill_no,
      report_no,
      caller_system,
      ip_address
    });

    if (!timeline) {
      return res.status(404).json({ error: '未找到运单或报告' });
    }

    res.json({
      success: true,
      data: timeline
    });
  } catch (err) {
    console.error('审计时间线查询失败:', err);
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

router.get('/audit/export', (req, res) => {
  try {
    const waybill_no = req.query.waybill_no;
    const report_no = req.query.report_no;
    const caller_system = req.headers['x-caller-system'] || 'admin-console';
    const ip_address = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.headers['x-real-ip'] || req.ip || req.connection?.remoteAddress || 'unknown';

    if (!waybill_no && !report_no) {
      return res.status(400).json({ error: '必须提供 waybill_no 或 report_no' });
    }

    const pkg = QueryService.exportAuditPackage({
      waybill_no,
      report_no,
      caller_system,
      ip_address
    });

    if (!pkg) {
      return res.status(404).json({ error: '未找到运单或报告' });
    }

    const format = req.query.format || 'json';

    if (format === 'json_download') {
      const filename = `audit_${waybill_no || report_no}_${Date.now()}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.json(pkg);
    }

    res.json({
      success: true,
      data: pkg
    });
  } catch (err) {
    console.error('审计导出失败:', err);
    res.status(500).json({ error: '导出失败', message: err.message });
  }
});

module.exports = router;
