const TransportTaskModel = require('../models/transportTask');
const TemperatureRecordModel = require('../models/temperatureRecord');
const TempRuleModel = require('../models/tempRule');
const AlertModel = require('../models/alert');
const QueryLogModel = require('../models/queryLog');
const TemperatureService = require('./temperatureService');

class QueryService {
  static getTemperatureSummary(waybill_no, { caller_system, ip_address } = {}) {
    const task = TransportTaskModel.findByWaybillNo(waybill_no);
    if (!task) {
      QueryLogModel.create({
        query_type: 'summary',
        waybill_no,
        caller_system,
        result_count: 0,
        ip_address
      });
      return null;
    }

    const stats = TemperatureRecordModel.getStatsByWaybill(waybill_no);
    const rule = TempRuleModel.findByProductType(task.product_type);
    const alertStats = AlertModel.getStatsByWaybill(waybill_no);
    const compliance = this._calculateCompliance(stats, rule, alertStats);

    const latestAlert = this._getLatestAlert(waybill_no);

    QueryLogModel.create({
      query_type: 'summary',
      waybill_no,
      caller_system,
      result_count: 1,
      ip_address
    });

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
        avg_temp: stats.avg_temp !== null && stats.avg_temp !== undefined 
          ? Number(Number(stats.avg_temp).toFixed(2)) 
          : null,
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
      alert_summary: this._formatAlertStats(alertStats),
      compliance: compliance,
      latest_alert: latestAlert
    };
  }

  static getTemperatureRecords(waybill_no, options = {}) {
    const result = TemperatureRecordModel.findByWaybillNo(waybill_no, options);
    
    QueryLogModel.create({
      query_type: 'records',
      waybill_no,
      caller_system: options.caller_system,
      result_count: result.total,
      ip_address: options.ip_address
    });

    return result;
  }

  static getAlertsByWaybill(waybill_no, { caller_system, ip_address } = {}) {
    const alerts = AlertModel.findByWaybillNo(waybill_no);

    QueryLogModel.create({
      query_type: 'alerts',
      waybill_no,
      caller_system,
      result_count: alerts.length,
      ip_address
    });

    return alerts.map(alert => this._formatAlert(alert));
  }

  static getAlertsByRole(role, options = {}) {
    const result = AlertModel.findByRole(role, options);
    
    QueryLogModel.create({
      query_type: 'alerts_by_role',
      caller_system: options.caller_system,
      result_count: result.total,
      ip_address: options.ip_address
    });

    return {
      ...result,
      list: result.list.map(alert => this._formatAlert(alert))
    };
  }

  static getTemperatureReport(waybill_no, { caller_system, ip_address } = {}) {
    const task = TransportTaskModel.findByWaybillNo(waybill_no);
    if (!task) {
      QueryLogModel.create({
        query_type: 'report',
        waybill_no,
        caller_system,
        result_count: 0,
        ip_address
      });
      return null;
    }

    const rule = TempRuleModel.findByProductType(task.product_type);
    const records = TemperatureRecordModel.findAllByWaybill(waybill_no);
    const alerts = AlertModel.getAlertSegmentsByWaybill(waybill_no);
    const alertStats = AlertModel.getStatsByWaybill(waybill_no);
    const stats = TemperatureRecordModel.getStatsByWaybill(waybill_no);
    const timeRange = TemperatureRecordModel.getTimeRangeByWaybill(waybill_no);

    const temperatureCurve = this._buildTemperatureCurve(records, rule);
    const outOfRangeSegments = this._extractOutOfRangeSegments(alerts, records);
    const compliance = this._calculateCompliance(stats, rule, alertStats);
    const acceptanceAdvice = this._generateAcceptanceAdvice(compliance, alertStats, rule);

    QueryLogModel.create({
      query_type: 'report',
      waybill_no,
      caller_system,
      result_count: 1,
      ip_address
    });

    return {
      report_type: 'temperature_control_report',
      report_version: '1.0',
      generated_at: new Date().toISOString(),
      
      waybill_info: {
        waybill_no: task.waybill_no,
        plate_number: task.plate_number,
        compartment_no: task.compartment_no,
        product_type: task.product_type,
        product_name: task.product_name,
        origin: task.origin,
        destination: task.destination,
        task_status: task.status,
        start_time: task.start_time,
        end_time: task.end_time
      },

      rule_info: rule ? {
        product_type: rule.product_type,
        product_name: rule.product_name,
        temperature_range: {
          min: rule.min_temp,
          max: rule.max_temp
        },
        warning_range: rule.warning_min_temp !== null && rule.warning_max_temp !== null ? {
          min: rule.warning_min_temp,
          max: rule.warning_max_temp
        } : null,
        alert_level: rule.alert_level,
        description: rule.description
      } : null,

      monitoring_summary: {
        total_records: stats.record_count || 0,
        time_range: {
          start: timeRange.min_time,
          end: timeRange.max_time
        },
        duration_minutes: timeRange.min_time && timeRange.max_time
          ? Math.round((new Date(timeRange.max_time) - new Date(timeRange.min_time)) / 60000)
          : 0,
        temperature_stats: {
          min: stats.min_temp,
          max: stats.max_temp,
          average: stats.avg_temp !== null && stats.avg_temp !== undefined
            ? Number(Number(stats.avg_temp).toFixed(2))
            : null
        }
      },

      temperature_curve: temperatureCurve,

      out_of_range_segments: outOfRangeSegments,

      alert_statistics: this._formatAlertStats(alertStats),

      compliance_assessment: compliance,

      acceptance_advice: acceptanceAdvice
    };
  }

  static _buildTemperatureCurve(records, rule) {
    if (!records || records.length === 0) {
      return { points: [], in_range_count: 0, out_of_range_count: 0 };
    }

    const points = records.map(r => ({
      time: r.record_time,
      temperature: r.temperature,
      humidity: r.humidity,
      location: r.location_lat && r.location_lng ? {
        lat: r.location_lat,
        lng: r.location_lng,
        text: r.location_text
      } : null,
      status: this._getTemperatureStatus(r.temperature, rule)
    }));

    const inRangeCount = points.filter(p => p.status === 'normal').length;
    const outOfRangeCount = points.length - inRangeCount;

    return {
      total_points: points.length,
      in_range_count: inRangeCount,
      out_of_range_count: outOfRangeCount,
      points: points
    };
  }

  static _getTemperatureStatus(temp, rule) {
    if (!rule) return 'unknown';
    
    if (temp > rule.max_temp || temp < rule.min_temp) {
      return 'out_of_range';
    }
    
    if ((rule.warning_max_temp !== null && rule.warning_max_temp !== undefined && temp > rule.warning_max_temp) ||
        (rule.warning_min_temp !== null && rule.warning_min_temp !== undefined && temp < rule.warning_min_temp)) {
      return 'warning';
    }
    
    return 'normal';
  }

  static _extractOutOfRangeSegments(alerts, records) {
    const segments = alerts.map(alert => {
      const alertRecords = records.filter(r => {
        const recordTime = new Date(r.record_time).getTime();
        const startTime = new Date(alert.start_time).getTime();
        const endTime = alert.end_time ? new Date(alert.end_time).getTime() : Date.now();
        return recordTime >= startTime && recordTime <= endTime;
      });

      const temperatures = alertRecords.map(r => r.temperature);
      const peakTemp = temperatures.length > 0 
        ? (alert.alert_type.includes('over') ? Math.max(...temperatures) : Math.min(...temperatures))
        : alert.peak_temperature;

      return {
        id: alert.id,
        alert_type: alert.alert_type,
        alert_level: alert.alert_level,
        start_time: alert.start_time,
        end_time: alert.end_time,
        duration_seconds: alert.duration_seconds,
        duration_formatted: TemperatureService.formatDuration(alert.duration_seconds),
        peak_temperature: peakTemp,
        threshold: alert.threshold,
        max_deviation: alert.deviation,
        status: alert.status,
        record_count: alertRecords.length,
        acknowledged: alert.acknowledged,
        acknowledged_by: alert.acknowledged_by,
        acknowledged_at: alert.acknowledged_at
      };
    });

    return segments.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }

  static _generateAcceptanceAdvice(compliance, alertStats, rule) {
    const advices = [];
    let acceptance_status = 'acceptable';

    if (compliance.rate >= 98) {
      acceptance_status = 'normal';
      advices.push('温控情况良好，货品质量有保障，可正常验收');
    } else if (compliance.rate >= 95) {
      acceptance_status = 'acceptable';
      advices.push('存在少量温度波动，建议抽样检查货品外观和质量');
    } else if (compliance.rate >= 90) {
      acceptance_status = 'caution';
      advices.push('温度异常较多，建议加强抽检，必要时进行质量检测');
    } else {
      acceptance_status = 'reject';
      advices.push('温度严重超标，建议拒收并启动质量事故调查流程');
    }

    if (alertStats.by_level.critical > 0) {
      advices.push('存在严重级告警，请质控人员重点核查');
      if (acceptance_status !== 'reject') acceptance_status = 'caution';
    }

    if (alertStats.by_level.serious > 2) {
      advices.push('严重告警多次出现，建议联系承运人了解运输过程情况');
    }

    if (alertStats.open_count > 0) {
      advices.push('当前仍有未结束的温度异常，请关注到货时温度状态');
    }

    if (rule && rule.product_type === 'vaccine') {
      if (compliance.rate < 98) {
        advices.push('疫苗类产品对温度敏感，建议启动冷链断链评估');
      }
    }

    return {
      acceptance_status,
      overall_assessment: compliance.description,
      compliance_rate: compliance.rate,
      advices: advices,
      suggested_actions: this._getSuggestedActions(acceptance_status)
    };
  }

  static _getSuggestedActions(status) {
    const actions = {
      normal: [
        '正常验收入库',
        '按常规流程处理'
      ],
      acceptable: [
        '抽检货品外观和包装',
        '测量中心温度确认',
        '记录温度异常情况'
      ],
      caution: [
        '增加抽检比例',
        '联系质控部门评估',
        '拍照留证',
        '单独存放等待评估'
      ],
      reject: [
        '暂停验收流程',
        '立即通知质控和采购部门',
        '启动质量事故调查',
        '保留所有温度数据作为证据'
      ]
    };
    return actions[status] || actions.acceptable;
  }

  static _formatAlertStats(stats) {
    return {
      total_count: stats.total_count,
      open_count: stats.open_count,
      by_level: stats.by_level,
      total_duration_seconds: stats.total_duration_seconds,
      total_duration_formatted: TemperatureService.formatDuration(stats.total_duration_seconds),
      max_duration_seconds: stats.max_duration_seconds,
      max_duration_formatted: TemperatureService.formatDuration(stats.max_duration_seconds)
    };
  }

  static _formatAlert(alert) {
    return {
      ...alert,
      duration_formatted: TemperatureService.formatDuration(alert.duration_seconds || 0),
      notify_roles: alert.notify_roles ? alert.notify_roles.split(',') : [],
      is_open: alert.end_time ? false : true,
      status: alert.end_time ? 'closed' : 'open'
    };
  }

  static _getLatestAlert(waybill_no) {
    const alerts = AlertModel.findByWaybillNo(waybill_no);
    if (alerts.length === 0) return null;
    
    const latest = alerts[0];
    return this._formatAlert(latest);
  }

  static _calculateCompliance(stats, rule, alertStats) {
    if (!rule || !stats || stats.record_count === 0) {
      return { status: 'unknown', rate: null, description: '数据不足，无法评估' };
    }

    const totalRecords = stats.record_count;
    const outOfRangeCount = alertStats.total_count;
    
    let complianceRate = 100;
    if (totalRecords > 0 && outOfRangeCount > 0) {
      complianceRate = Math.max(0, Math.round((1 - outOfRangeCount / totalRecords) * 100));
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
      poor: '温控较差，异常较多，需重点关注',
      unknown: '数据不足，无法评估'
    };
    return descriptions[status] || '未知';
  }
}

module.exports = QueryService;
