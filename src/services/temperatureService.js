const TemperatureRecordModel = require('../models/temperatureRecord');
const TransportTaskModel = require('../models/transportTask');
const TempRuleModel = require('../models/tempRule');
const AlertModel = require('../models/alert');

const ALERT_TYPES = {
  OVER_MAX: 'over_max',
  BELOW_MIN: 'below_min',
  WARNING_HIGH: 'warning_high',
  WARNING_LOW: 'warning_low'
};

const ALERT_LEVELS = {
  INFO: 'info',
  WARNING: 'warning',
  SERIOUS: 'serious',
  CRITICAL: 'critical'
};

class TemperatureService {
  static reportTemperature(data) {
    const { device_no, plate_number, compartment_no, temperature, 
            humidity, location_lat, location_lng, location_text, record_time } = data;

    const recordTime = record_time || new Date().toISOString();

    const existing = TemperatureRecordModel.findByDeviceAndTime(device_no, recordTime);
    if (existing) {
      return {
        record: existing,
        waybill_no: existing.waybill_no,
        alert: null,
        duplicated: true
      };
    }

    let task = TransportTaskModel.findActiveByDevice(plate_number, compartment_no);
    let waybill_no = task ? task.waybill_no : null;

    const record = TemperatureRecordModel.create({
      device_no,
      plate_number,
      compartment_no,
      waybill_no,
      temperature,
      humidity,
      location_lat,
      location_lng,
      location_text,
      record_time: recordTime
    });

    let alertResult = null;
    if (task) {
      alertResult = this._checkAndUpdateAlerts(task, temperature, recordTime, device_no);
    }

    return {
      record,
      waybill_no,
      alert: alertResult,
      duplicated: false
    };
  }

  static batchReportTemperature(records) {
    if (!Array.isArray(records) || records.length === 0) {
      return { success: false, error: '上报数据不能为空' };
    }

    const sortedRecords = [...records].sort((a, b) => 
      new Date(a.record_time).getTime() - new Date(b.record_time).getTime()
    );

    const results = [];
    let successCount = 0;
    let duplicateCount = 0;
    let alertCount = 0;
    const activeAlerts = new Map();

    for (const recordData of sortedRecords) {
      try {
        const { device_no, plate_number, compartment_no } = recordData;
        
        const existing = TemperatureRecordModel.findByDeviceAndTime(
          device_no, recordData.record_time
        );
        
        if (existing) {
          duplicateCount++;
          results.push({
            record_time: recordData.record_time,
            success: true,
            duplicated: true,
            record_id: existing.id
          });
          continue;
        }

        let task = TransportTaskModel.findActiveByDevice(plate_number, compartment_no);
        let waybill_no = task ? task.waybill_no : null;

        const record = TemperatureRecordModel.create({
          device_no,
          plate_number,
          compartment_no,
          waybill_no,
          temperature: recordData.temperature,
          humidity: recordData.humidity,
          location_lat: recordData.location_lat,
          location_lng: recordData.location_lng,
          location_text: recordData.location_text,
          record_time: recordData.record_time
        });

        let alertResult = null;
        if (task) {
          alertResult = this._checkAndUpdateAlerts(
            task, 
            recordData.temperature, 
            recordData.record_time, 
            device_no
          );
          if (alertResult) alertCount++;
        }

        successCount++;
        results.push({
          record_time: recordData.record_time,
          success: true,
          duplicated: false,
          record_id: record.id,
          waybill_no,
          has_alert: !!alertResult,
          alert_level: alertResult ? alertResult.alert_level : null
        });
      } catch (err) {
        results.push({
          record_time: recordData.record_time,
          success: false,
          error: err.message
        });
      }
    }

    return {
      success: true,
      summary: {
        total: records.length,
        success: successCount,
        duplicated: duplicateCount,
        failed: records.length - successCount - duplicateCount,
        new_alerts: alertCount
      },
      details: results
    };
  }

  static _checkAndUpdateAlerts(task, temperature, recordTime, device_no) {
    const rule = TempRuleModel.findByProductType(task.product_type);
    if (!rule) return null;

    const alertInfo = this._evaluateTemperature(temperature, rule);
    
    if (!alertInfo) {
      this._closeAllOpenAlerts(device_no, temperature, recordTime);
      return null;
    }

    const existingAlert = AlertModel.findOpenAlert(device_no, alertInfo.type);
    let alert;

    if (existingAlert) {
      const duration = this._calculateDuration(existingAlert.start_time, recordTime);
      alert = AlertModel.updateDuration(existingAlert.id, duration, temperature);
    } else {
      this._closeOtherTypeAlerts(device_no, alertInfo.type, temperature, recordTime);
      alert = AlertModel.create({
        waybill_no: task.waybill_no,
        device_no,
        alert_type: alertInfo.type,
        alert_level: alertInfo.level,
        temperature,
        threshold: alertInfo.threshold,
        start_time: recordTime,
        notify_roles: rule.notify_roles
      });
    }

    const durationSeconds = alert.duration_seconds || 0;
    const isNew = !existingAlert;
    
    return {
      id: alert.id,
      alert_type: alert.alert_type,
      alert_level: alert.alert_level,
      temperature: alert.temperature,
      threshold: alert.threshold,
      duration_seconds: durationSeconds,
      duration_formatted: this.formatDuration(durationSeconds),
      start_time: alert.start_time,
      end_time: alert.end_time || null,
      status: isNew ? 'new' : 'ongoing',
      notify_roles: alert.notify_roles ? alert.notify_roles.split(',') : [],
      description: alertInfo.description,
      action_required: this._getActionRequired(alertInfo.level, alertInfo.type)
    };
  }

  static _evaluateTemperature(temp, rule) {
    if (temp > rule.max_temp) {
      return {
        type: ALERT_TYPES.OVER_MAX,
        level: rule.alert_level || ALERT_LEVELS.SERIOUS,
        threshold: rule.max_temp,
        description: `温度 ${temp}°C 超出上限 ${rule.max_temp}°C`
      };
    }
    
    if (temp < rule.min_temp) {
      return {
        type: ALERT_TYPES.BELOW_MIN,
        level: rule.alert_level || ALERT_LEVELS.SERIOUS,
        threshold: rule.min_temp,
        description: `温度 ${temp}°C 低于下限 ${rule.min_temp}°C`
      };
    }

    if (rule.warning_max_temp !== null && rule.warning_max_temp !== undefined && temp > rule.warning_max_temp) {
      return {
        type: ALERT_TYPES.WARNING_HIGH,
        level: ALERT_LEVELS.WARNING,
        threshold: rule.warning_max_temp,
        description: `温度 ${temp}°C 接近上限 ${rule.max_temp}°C，请注意`
      };
    }

    if (rule.warning_min_temp !== null && rule.warning_min_temp !== undefined && temp < rule.warning_min_temp) {
      return {
        type: ALERT_TYPES.WARNING_LOW,
        level: ALERT_LEVELS.WARNING,
        threshold: rule.warning_min_temp,
        description: `温度 ${temp}°C 接近下限 ${rule.min_temp}°C，请注意`
      };
    }

    return null;
  }

  static _closeAllOpenAlerts(device_no, currentTemp, endTime) {
    const openAlerts = AlertModel.findAllOpenAlertsByDevice(device_no);
    const closed = [];

    for (const alert of openAlerts) {
      const duration = this._calculateDuration(alert.start_time, endTime);
      const updated = AlertModel.updateDuration(alert.id, duration, currentTemp, endTime);
      closed.push({
        id: updated.id,
        alert_type: updated.alert_type,
        duration_seconds: updated.duration_seconds
      });
    }

    return closed;
  }

  static _closeOtherTypeAlerts(device_no, currentType, currentTemp, endTime) {
    const openAlerts = AlertModel.findAllOpenAlertsByDevice(device_no);
    
    for (const alert of openAlerts) {
      if (alert.alert_type !== currentType) {
        const duration = this._calculateDuration(alert.start_time, endTime);
        AlertModel.updateDuration(alert.id, duration, currentTemp, endTime);
      }
    }
  }

  static _calculateDuration(startTime, endTime) {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    return Math.max(0, Math.floor((end - start) / 1000));
  }

  static formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}小时`);
    if (minutes > 0) parts.push(`${minutes}分钟`);
    if (secs > 0 && hours === 0) parts.push(`${secs}秒`);
    
    return parts.length > 0 ? parts.join('') : '0秒';
  }

  static _getActionRequired(level, type) {
    const actions = {
      critical: {
        over_max: '立即停车检查制冷设备，联系质控和调度',
        below_min: '立即检查是否过度制冷，调整温度设定',
        default: '立即处理，严重影响货品质量'
      },
      serious: {
        over_max: '尽快检查制冷系统，观察温度趋势',
        below_min: '检查温控设置，适当调高温度',
        default: '尽快处理，避免影响货品'
      },
      warning: {
        over_max: '注意观察温度趋势，必要时调整',
        below_min: '注意观察温度趋势，必要时调整',
        default: '关注温度变化，提前预防'
      }
    };

    const levelActions = actions[level] || actions.warning;
    return levelActions[type] || levelActions.default || '关注温度变化';
  }

  static getLatestTemperature(device_no) {
    return TemperatureRecordModel.getLatestByDevice(device_no);
  }
}

module.exports = TemperatureService;
module.exports.ALERT_TYPES = ALERT_TYPES;
module.exports.ALERT_LEVELS = ALERT_LEVELS;
