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
  static async reportTemperature(data) {
    const { device_no, plate_number, compartment_no, temperature, 
            humidity, location_lat, location_lng, location_text, record_time } = data;

    const recordTime = record_time || new Date().toISOString();

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
      alert: alertResult
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
      this._closeAllOpenAlerts(device_no, temperature, recordTime);
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

    return {
      id: alert.id,
      alert_type: alert.alert_type,
      alert_level: alert.alert_level,
      temperature: alert.temperature,
      threshold: alert.threshold,
      duration_seconds: alert.duration_seconds,
      start_time: alert.start_time,
      notify_roles: alert.notify_roles ? alert.notify_roles.split(',') : [],
      description: alertInfo.description
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

    if (rule.warning_max_temp !== null && temp > rule.warning_max_temp) {
      return {
        type: ALERT_TYPES.WARNING_HIGH,
        level: ALERT_LEVELS.WARNING,
        threshold: rule.warning_max_temp,
        description: `温度 ${temp}°C 接近上限 ${rule.max_temp}°C，请注意`
      };
    }

    if (rule.warning_min_temp !== null && temp < rule.warning_min_temp) {
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
    const db = require('../db').getDb();
    const openAlerts = db.prepare(`
      SELECT * FROM alerts WHERE device_no = ? AND end_time IS NULL
    `).all(device_no);

    for (const alert of openAlerts) {
      const duration = this._calculateDuration(alert.start_time, endTime);
      AlertModel.updateDuration(alert.id, duration, currentTemp, endTime);
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
}

module.exports = TemperatureService;
module.exports.ALERT_TYPES = ALERT_TYPES;
module.exports.ALERT_LEVELS = ALERT_LEVELS;
