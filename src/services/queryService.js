const TransportTaskModel = require('../models/transportTask');
const TemperatureRecordModel = require('../models/temperatureRecord');
const TempRuleModel = require('../models/tempRule');
const AlertModel = require('../models/alert');
const QueryLogModel = require('../models/queryLog');
const TemperatureService = require('./temperatureService');

class QueryService {
  static getTemperatureSummary(waybill_no, { caller_system, ip_address } = {}) {
    QueryLogModel.create({
      query_type: 'summary',
      waybill_no,
      caller_system,
      result_count: 1,
      ip_address
    });

    const task = TransportTaskModel.findByWaybillNo(waybill_no);
    if (!task) {
      return null;
    }

    const stats = TemperatureRecordModel.getStatsByWaybill(waybill_no);
    const rule = TempRuleModel.findByProductType(task.product_type);
    const alerts = AlertModel.findByWaybillNo(waybill_no);

    const alertStats = this._calculateAlertStats(alerts);
    const compliance = this._calculateCompliance(stats, rule, alertStats);

    return {
      waybill_no: task.waybill_no,
      task_info: {
        plate_number: task.plate_number,
        compartment_no: task.compartment_no,
        product_type: task.product_type,
        product_name: task.product_name,
        origin: task.origin,
        destination: task.destination,
        status: task.status,
        start_time: task.start_time,
        end_time: task.end_time
      },
      temperature_summary: {
        record_count: stats.record_count || 0,
        min_temp: stats.min_temp,
        max_temp: stats.max_temp,
        avg_temp: stats.avg_temp ? Number(stats.avg_temp.toFixed(2)) : null,
        first_record_time: stats.first_record_time,
        last_record_time: stats.last_record_time,
        time_span_minutes: stats.first_record_time && stats.last_record_time
          ? Math.round((new Date(stats.last_record_time) - new Date(stats.first_record_time)) / 60000)
          : 0
      },
      rule_info: rule ? {
        product_type: rule.product_type,
        product_name: rule.product_name,
        min_temp: rule.min_temp,
        max_temp: rule.max_temp,
        warning_min_temp: rule.warning_min_temp,
        warning_max_temp: rule.warning_max_temp,
        alert_level: rule.alert_level,
        notify_roles: rule.notify_roles ? rule.notify_roles.split(',') : []
      } : null,
      alert_summary: alertStats,
      compliance: compliance,
      latest_alert: alerts.length > 0 ? alerts[0] : null
    };
  }

  static getTemperatureRecords(waybill_no, options = {}) {
    QueryLogModel.create({
      query_type: 'records',
      waybill_no,
      caller_system: options.caller_system,
      result_count: 0,
      ip_address: options.ip_address
    });

    const result = TemperatureRecordModel.findByWaybillNo(waybill_no, options);
    
    const db = require('../db').getDb();
    db.prepare(`
      UPDATE query_logs SET result_count = ? WHERE id = ?
    `).run(result.total, result.list.length > 0 ? result.list[result.list.length - 1].id : null);

    return result;
  }

  static getAlertsByWaybill(waybill_no, { caller_system, ip_address } = {}) {
    QueryLogModel.create({
      query_type: 'alerts',
      waybill_no,
      caller_system,
      result_count: 0,
      ip_address
    });

    const alerts = AlertModel.findByWaybillNo(waybill_no);

    const db = require('../db').getDb();
    const latestLog = db.prepare(`
      SELECT id FROM query_logs WHERE query_type = 'alerts' AND waybill_no = ?
      ORDER BY query_time DESC LIMIT 1
    `).get(waybill_no);
    
    if (latestLog) {
      db.prepare('UPDATE query_logs SET result_count = ? WHERE id = ?')
        .run(alerts.length, latestLog.id);
    }

    return alerts.map(alert => ({
      ...alert,
      duration_formatted: TemperatureService.formatDuration(alert.duration_seconds),
      notify_roles: alert.notify_roles ? alert.notify_roles.split(',') : []
    }));
  }

  static _calculateAlertStats(alerts) {
    const stats = {
      total_count: alerts.length,
      open_count: 0,
      by_level: {
        critical: 0,
        serious: 0,
        warning: 0,
        info: 0
      },
      total_duration_seconds: 0,
      max_duration_seconds: 0
    };

    for (const alert of alerts) {
      if (!alert.end_time) {
        stats.open_count++;
      }
      
      const level = alert.alert_level.toLowerCase();
      if (stats.by_level.hasOwnProperty(level)) {
        stats.by_level[level]++;
      }

      if (alert.duration_seconds > stats.max_duration_seconds) {
        stats.max_duration_seconds = alert.duration_seconds;
      }
      stats.total_duration_seconds += alert.duration_seconds;
    }

    stats.total_duration_formatted = TemperatureService.formatDuration(stats.total_duration_seconds);
    stats.max_duration_formatted = TemperatureService.formatDuration(stats.max_duration_seconds);

    return stats;
  }

  static _calculateCompliance(stats, rule, alertStats) {
    if (!rule || !stats || stats.record_count === 0) {
      return { status: 'unknown', rate: null };
    }

    const totalRecords = stats.record_count;
    const outOfRangeRecords = alertStats.total_count;
    
    let complianceRate = 100;
    if (totalRecords > 0 && outOfRangeRecords > 0) {
      complianceRate = Math.max(0, Math.round((1 - outOfRangeRecords / totalRecords) * 100));
    }

    let status;
    if (complianceRate >= 98) {
      status = 'excellent';
    } else if (complianceRate >= 95) {
      status = 'good';
    } else if (complianceRate >= 90) {
      status = 'acceptable';
    } else {
      status = 'poor';
    }

    return {
      status,
      rate: complianceRate,
      description: this._getComplianceDescription(status)
    };
  }

  static _getComplianceDescription(status) {
    const descriptions = {
      excellent: '温控优秀，全程温度稳定',
      good: '温控良好，偶有小幅波动',
      acceptable: '温控基本达标，存在少量异常',
      poor: '温控较差，异常较多，需重点关注'
    };
    return descriptions[status] || '未知';
  }
}

module.exports = QueryService;
