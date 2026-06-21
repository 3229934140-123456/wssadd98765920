const TransportTaskModel = require('../models/transportTask');
const TemperatureRecordModel = require('../models/temperatureRecord');
const TempRuleModel = require('../models/tempRule');
const AlertModel = require('../models/alert');
const QueryLogModel = require('../models/queryLog');
const AlertHandlingModel = require('../models/alertHandling');
const ReportModel = require('../models/report');
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

  static getTodoAlerts(role, options = {}) {
    const result = AlertModel.getTodoAlerts(role, options);

    QueryLogModel.create({
      query_type: 'alerts_todo',
      caller_system: options.caller_system,
      result_count: result.total,
      ip_address: options.ip_address
    });

    return {
      ...result,
      list: result.list.map(alert => this._formatAlert(alert))
    };
  }

  static getInvolvedAlerts(role, options = {}) {
    const result = AlertModel.getInvolvedAlerts(role, options);

    QueryLogModel.create({
      query_type: 'alerts_involved',
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

  static getShareableReport(waybill_no, { caller_system, ip_address, force_regenerate } = {}) {
    const task = TransportTaskModel.findByWaybillNo(waybill_no);
    if (!task) {
      QueryLogModel.create({
        query_type: 'shareable_report',
        waybill_no,
        caller_system,
        result_count: 0,
        ip_address
      });
      return null;
    }

    if (!force_regenerate) {
      const active = ReportModel.findActiveByWaybillNo(waybill_no);
      if (active) {
        const reportData = typeof active.report_data === 'string'
          ? JSON.parse(active.report_data)
          : active.report_data;

        QueryLogModel.create({
          query_type: 'shareable_report',
          waybill_no,
          caller_system,
          result_count: 1,
          ip_address
        });

        return {
          ...reportData,
          report_no: active.report_no,
          version: Number(active.version) || 1,
          report_status: active.status,
          replaced_by: active.replaced_by,
          is_cached: true,
          is_latest_version: true,
          version_chain: ReportModel.getVersionChain(waybill_no)
        };
      }
    }

    const report = this._buildShareableReport(waybill_no, task);
    if (!report) return null;

    let savedReport;
    if (force_regenerate) {
      savedReport = ReportModel.createNewVersion(waybill_no, report);
    } else {
      const newVersion = ReportModel.getLatestVersion(waybill_no) + 1;
      const reportNo = ReportModel.generateReportNo();
      savedReport = ReportModel.create({
        report_no: reportNo,
        waybill_no,
        version: newVersion,
        status: 'active',
        report_data: report
      });
    }

    const loaded = ReportModel.findByReportNo(savedReport.report_no);
    const reportData = typeof loaded.report_data === 'string'
      ? JSON.parse(loaded.report_data)
      : loaded.report_data;

    QueryLogModel.create({
      query_type: 'shareable_report',
      waybill_no,
      caller_system,
      result_count: 1,
      ip_address
    });

    return {
      ...reportData,
      report_no: loaded.report_no,
      version: Number(loaded.version) || 1,
      report_status: loaded.status,
      replaced_by: loaded.replaced_by,
      is_cached: false,
      is_latest_version: true,
      version_chain: ReportModel.getVersionChain(waybill_no)
    };
  }

  static getReportByNo(report_no, { caller_system, ip_address } = {}) {
    const report = ReportModel.findByReportNo(report_no);
    if (!report) {
      QueryLogModel.create({
        query_type: 'report_by_no',
        caller_system,
        result_count: 0,
        ip_address
      });
      return null;
    }

    const reportData = typeof report.report_data === 'string'
      ? JSON.parse(report.report_data)
      : report.report_data;

    const isLatest = report.status === 'active';
    const versionChain = ReportModel.getVersionChain(report.waybill_no);
    const currentActive = versionChain.find(v => v.is_current);

    QueryLogModel.create({
      query_type: 'report_by_no',
      waybill_no: report.waybill_no,
      caller_system,
      result_count: 1,
      ip_address
    });

    return {
      ...reportData,
      report_no: report.report_no,
      version: Number(report.version) || 1,
      report_status: report.status,
      replaced_by: report.replaced_by,
      is_cached: true,
      is_latest_version: isLatest,
      superseded_by: report.status === 'deprecated' && report.replaced_by
        ? { report_no: report.replaced_by, current_version: currentActive ? Number(currentActive.version) : null }
        : null,
      version_chain: versionChain
    };
  }

  static deprecateReport(report_no, { caller_system, ip_address } = {}) {
    const report = ReportModel.findByReportNo(report_no);
    if (!report) return null;

    ReportModel.deprecate(report.id);
    const updated = ReportModel.findByReportNo(report_no);

    QueryLogModel.create({
      query_type: 'report_deprecate',
      waybill_no: report.waybill_no,
      caller_system,
      result_count: 1,
      ip_address
    });

    return {
      report_no: updated.report_no,
      waybill_no: updated.waybill_no,
      version: Number(updated.version) || 1,
      status: updated.status,
      replaced_by: updated.replaced_by
    };
  }

  static _buildShareableReport(waybill_no, task) {
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

    const handlings = AlertHandlingModel.findByWaybillNo(waybill_no);
    const handlingSummary = this._buildHandlingSummary(handlings);

    return {
      report_type: 'shareable_temperature_report',
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

      acceptance_conclusion: {
        acceptance_status: acceptanceAdvice.acceptance_status,
        overall_assessment: compliance.description,
        compliance_rate: compliance.rate,
        compliance_status: compliance.status,
        advices: acceptanceAdvice.advices,
        suggested_actions: acceptanceAdvice.suggested_actions
      },

      anomaly_evidence: {
        total_records: stats.record_count || 0,
        monitoring_duration_minutes: timeRange.min_time && timeRange.max_time
          ? Math.round((new Date(timeRange.max_time) - new Date(timeRange.min_time)) / 60000)
          : 0,
        temperature_stats: {
          min: stats.min_temp,
          max: stats.max_temp,
          average: stats.avg_temp !== null && stats.avg_temp !== undefined
            ? Number(Number(stats.avg_temp).toFixed(2))
            : null
        },
        out_of_range_segments: outOfRangeSegments,
        alert_statistics: this._formatAlertStats(alertStats),
        temperature_curve_summary: {
          total_points: temperatureCurve.total_points,
          in_range_count: temperatureCurve.in_range_count,
          out_of_range_count: temperatureCurve.out_of_range_count,
          in_range_rate: temperatureCurve.total_points > 0
            ? Number(((temperatureCurve.in_range_count / temperatureCurve.total_points) * 100).toFixed(1))
            : 100
        }
      },

      handling_summary: handlingSummary,

      rule_info: rule ? {
        product_type: rule.product_type,
        product_name: rule.product_name,
        temperature_range: { min: rule.min_temp, max: rule.max_temp },
        description: rule.description
      } : null
    };
  }

  static _buildHandlingSummary(handlings) {
    if (!handlings || handlings.length === 0) {
      return {
        total_handling_steps: 0,
        is_concluded: false,
        handling_chain: []
      };
    }

    const handlingChain = handlings.map(h => ({
      action: h.action,
      handler_role: h.handler_role,
      handler_name: h.handler_name,
      result: h.result,
      remark: h.remark,
      target_role: h.target_role,
      handled_at: h.created_at
    }));

    const concludedSteps = handlings.filter(h => h.action === 'conclude');

    return {
      total_handling_steps: handlings.length,
      is_concluded: concludedSteps.length > 0,
      conclusion: concludedSteps.length > 0 ? {
        result: concludedSteps[0].result,
        concluded_by: concludedSteps[0].handler_name,
        concluded_at: concludedSteps[0].created_at
      } : null,
      handling_chain: handlingChain
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
    const involved = alert.involved_roles ? alert.involved_roles.split(',').map(r => r.trim()).filter(Boolean) : [];
    return {
      ...alert,
      duration_formatted: TemperatureService.formatDuration(alert.duration_seconds || 0),
      notify_roles: alert.notify_roles ? alert.notify_roles.split(',').filter(Boolean) : [],
      involved_roles: involved,
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

  static getAuditTimeline({ waybill_no, report_no, caller_system, ip_address } = {}) {
    if (!waybill_no && !report_no) {
      return null;
    }

    let actualWaybill = waybill_no;
    if (report_no && !waybill_no) {
      const report = ReportModel.findByReportNo(report_no);
      if (!report) {
        return null;
      }
      actualWaybill = report.waybill_no;
    }

    const task = TransportTaskModel.findByWaybillNo(actualWaybill);
    if (!task) {
      return null;
    }

    const events = [];

    events.push({
      seq: 0,
      timestamp: task.start_time || task.created_at,
      type: 'task_create',
      category: 'task',
      title: '运输任务创建',
      description: `运单 ${actualWaybill} 创建，车牌 ${task.plate_number} 车厢 ${task.compartment_no}，货品 ${task.product_name || task.product_type}`,
      source_system: null,
      source_role: null,
      source_name: null,
      raw_data: {
        waybill_no: actualWaybill,
        origin: task.origin,
        destination: task.destination,
        status: task.status
      }
    });

    const records = TemperatureRecordModel.findAllByWaybill(actualWaybill);
    records.forEach((r, idx) => {
      events.push({
        seq: 1000 + idx,
        timestamp: r.record_time || r.created_at,
        type: 'temperature_report',
        category: 'temperature',
        title: `温度上报 ${r.temperature}°C`,
        description: `设备 ${r.device_no} 上报温度 ${r.temperature}°C${r.humidity ? `，湿度 ${r.humidity}%` : ''}${r.location_text ? `，位置 ${r.location_text}` : ''}`,
        source_system: 'temperature_device',
        source_role: null,
        source_name: r.device_no,
        raw_data: {
          device_no: r.device_no,
          temperature: r.temperature,
          humidity: r.humidity,
          location_lat: r.location_lat,
          location_lng: r.location_lng,
          location_text: r.location_text
        }
      });
    });

    const alerts = AlertModel.findByWaybillNo(actualWaybill);
    alerts.forEach((a, idx) => {
      events.push({
        seq: 2000 + idx * 2,
        timestamp: a.start_time || a.created_at,
        type: 'alert_create',
        category: 'alert',
        title: `告警产生：${a.alert_type} (${a.alert_level})`,
        description: `温度 ${a.temperature}°C，阈值 ${a.threshold}°C，告警类型 ${a.alert_type}，级别 ${a.alert_level}，通知角色 ${a.notify_roles || '(未知)'}`,
        source_system: null,
        source_role: null,
        source_name: null,
        raw_data: {
          alert_id: a.id,
          alert_type: a.alert_type,
          alert_level: a.alert_level,
          temperature: a.temperature,
          threshold: a.threshold,
          assignee: a.assignee,
          flow_status: a.flow_status,
          notify_roles: a.notify_roles ? a.notify_roles.split(',') : []
        }
      });

      if (a.end_time) {
        events.push({
          seq: 2000 + idx * 2 + 1,
          timestamp: a.end_time,
          type: 'alert_recover',
          category: 'alert',
          title: '温度恢复正常',
          description: `告警结束，累计持续 ${TemperatureService.formatDuration(a.duration_seconds || 0)}（${a.duration_seconds || 0}秒）`,
          source_system: null,
          source_role: null,
          source_name: null,
          raw_data: {
            alert_id: a.id,
            duration_seconds: a.duration_seconds,
            end_temperature: a.temperature
          }
        });
      }
    });

    const handlings = AlertHandlingModel.findByWaybillNo(actualWaybill);
    handlings.forEach((h, idx) => {
      const actionText = {
        process: '现场处理',
        reassign: '转派',
        escalate: '升级',
        conclude: '结案'
      }[h.action] || h.action;

      let description = `${h.handler_name || h.handler_role} 执行${actionText}`;
      if (h.result) description += `，结果：${h.result}`;
      if (h.target_role) description += ` → ${h.target_role}`;
      if (h.remark) description += `，备注：${h.remark}`;

      events.push({
        seq: 3000 + idx,
        timestamp: h.created_at,
        type: `alert_handle_${h.action}`,
        category: 'handling',
        title: `告警${actionText}`,
        description,
        source_system: null,
        source_role: h.handler_role,
        source_name: h.handler_name || h.handler_role,
        raw_data: {
          handling_id: h.id,
          action: h.action,
          handler_role: h.handler_role,
          handler_name: h.handler_name,
          result: h.result,
          remark: h.remark,
          target_role: h.target_role
        }
      });
    });

    const queryLogs = QueryLogModel.findAll({ waybill_no: actualWaybill, page_size: 1000 });
    if (queryLogs && queryLogs.list) {
      queryLogs.list.forEach((l, idx) => {
        const typeText = {
          summary: '温度摘要查询',
          records: '温度记录查询',
          alerts: '告警记录查询',
          report: '温控报告查询',
          shareable_report: '分享版报告查询',
          report_by_no: '按编号报告查询',
          alerts_by_role: '角色告警查询',
          alerts_todo: '待办告警查询',
          alerts_involved: '参与告警查询'
        }[l.query_type] || l.query_type;

        events.push({
          seq: 5000 + idx,
          timestamp: l.created_at,
          type: `external_query_${l.query_type}`,
          category: 'query',
          title: `外部系统调用：${typeText}`,
          description: `${l.caller_system || 'unknown'} 调用 ${l.query_type}，返回 ${l.result_count} 条结果${l.ip_address ? `，来源 ${l.ip_address}` : ''}`,
          source_system: l.caller_system || 'unknown',
          source_role: null,
          source_name: null,
          raw_data: {
            query_id: l.id,
            query_type: l.query_type,
            result_count: l.result_count,
            ip_address: l.ip_address
          }
        });
      });
    }

    if (report_no) {
      const report = ReportModel.findByReportNo(report_no);
      if (report) {
        events.push({
          seq: 6000,
          timestamp: report.created_at,
          type: 'report_generate',
          category: 'report',
          title: `分享版报告生成 ${report.report_no}`,
          description: `报告 ${report.report_no} 生成，关联运单 ${actualWaybill}，版本 v${report.version || '1.0'}${report.replaced_by ? `，已被 ${report.replaced_by} 替代` : ''}`,
          source_system: null,
          source_role: null,
          source_name: null,
          raw_data: {
            report_no: report.report_no,
            version: report.version,
            status: report.status,
            replaced_by: report.replaced_by
          }
        });
      }
    }

    const reports = ReportModel.findByWaybillNo(actualWaybill);
    reports.forEach((r, idx) => {
      if (report_no && r.report_no !== report_no) {
        events.push({
          seq: 6001 + idx,
          timestamp: r.created_at,
          type: 'report_generate',
          category: 'report',
          title: `分享版报告生成 ${r.report_no}`,
          description: `报告 ${r.report_no} 生成，关联运单 ${actualWaybill}，版本 v${r.version || '1.0'}${r.replaced_by ? `，已被 ${r.replaced_by} 替代` : ''}${r.status === 'deprecated' ? '，已作废' : ''}`,
          source_system: null,
          source_role: null,
          source_name: null,
          raw_data: {
            report_no: r.report_no,
            version: r.version,
            status: r.status,
            replaced_by: r.replaced_by
          }
        });
      }
    });

    events.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      if (ta !== tb) return ta - tb;
      return a.seq - b.seq;
    });

    QueryLogModel.create({
      query_type: 'audit_timeline',
      waybill_no: actualWaybill,
      caller_system,
      result_count: events.length,
      ip_address
    });

    return {
      waybill_no: actualWaybill,
      report_no: report_no || null,
      generated_at: new Date().toISOString(),
      event_count: events.length,
      category_counts: this._countCategories(events),
      timeline: events
    };
  }

  static _countCategories(events) {
    const counts = {};
    for (const e of events) {
      counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return counts;
  }
}

module.exports = QueryService;
