const { getDb } = require('../db');

class AlertModel {
  static create({ waybill_no, device_no, alert_type, alert_level, temperature, 
                  threshold, start_time, notify_roles }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO alerts 
      (waybill_no, device_no, alert_type, alert_level, temperature, threshold, start_time, notify_roles, duration_seconds, acknowledged)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `);
    const result = stmt.run(
      waybill_no || null, device_no, alert_type, alert_level,
      temperature, threshold, start_time, notify_roles || null
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
  }

  static findOpenAlert(device_no, alert_type) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM alerts 
      WHERE device_no = ? AND alert_type = ? AND end_time IS NULL
      ORDER BY start_time DESC LIMIT 1
    `).get(device_no, alert_type);
  }

  static findAllOpenAlertsByDevice(device_no) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM alerts 
      WHERE device_no = ? AND end_time IS NULL
      ORDER BY start_time ASC
    `).all(device_no);
  }

  static updateDuration(id, duration_seconds, current_temp, end_time = null) {
    const db = getDb();
    if (end_time) {
      db.prepare(`
        UPDATE alerts SET duration_seconds = ?, end_time = ?, temperature = ?
        WHERE id = ?
      `).run(duration_seconds, end_time, current_temp, id);
    } else {
      db.prepare(`
        UPDATE alerts SET duration_seconds = ?, temperature = ?
        WHERE id = ?
      `).run(duration_seconds, current_temp, id);
    }
    return this.findById(id);
  }

  static findByWaybillNo(waybill_no) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM alerts 
      WHERE waybill_no = ?
      ORDER BY start_time DESC
    `).all(waybill_no);
  }

  static findByRole(role, { page = 1, page_size = 20, status, alert_level, startTime, endTime } = {}) {
    const db = getDb();
    
    const allAlerts = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all();
    
    let filtered = allAlerts.filter(alert => {
      if (!alert.notify_roles) return false;
      const roles = alert.notify_roles.split(',').map(r => r.trim());
      if (!roles.includes(role)) return false;
      
      if (alert_level && alert.alert_level !== alert_level) return false;
      if (status === 'open' && alert.end_time !== null && alert.end_time !== undefined) return false;
      if (status === 'closed' && (alert.end_time === null || alert.end_time === undefined)) return false;
      if (status === 'unacknowledged' && alert.acknowledged === 1) return false;
      if (status === 'acknowledged' && alert.acknowledged !== 1) return false;
      if (startTime && alert.start_time < startTime) return false;
      if (endTime && alert.start_time > endTime) return false;
      
      return true;
    });
    
    const total = filtered.length;
    const offset = (page - 1) * page_size;
    const list = filtered.slice(offset, offset + page_size);
    
    return { list, total, page, page_size };
  }

  static findAll({ page = 1, page_size = 20, alert_level, acknowledged, status, startTime, endTime } = {}) {
    const db = getDb();
    const offset = (page - 1) * page_size;
    
    const clauses = [];
    const params = [];
    if (alert_level) {
      clauses.push('alert_level = ?');
      params.push(alert_level);
    }
    if (acknowledged !== undefined) {
      clauses.push('acknowledged = ?');
      params.push(acknowledged ? 1 : 0);
    }
    if (status === 'open') {
      clauses.push('end_time IS NULL');
    } else if (status === 'closed') {
      clauses.push('end_time IS NOT NULL');
    }
    if (startTime) {
      clauses.push('start_time >= ?');
      params.push(startTime);
    }
    if (endTime) {
      clauses.push('start_time <= ?');
      params.push(endTime);
    }
    
    const whereStr = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM alerts ${whereStr}`).get(...params).cnt;
    const list = db.prepare(`
      SELECT * FROM alerts ${whereStr}
      ORDER BY start_time DESC LIMIT ? OFFSET ?
    `).all(...params, page_size, offset);
    
    return { list, total, page, page_size };
  }

  static getAlertSegmentsByWaybill(waybill_no) {
    const alerts = this.findByWaybillNo(waybill_no);
    
    return alerts.map(alert => ({
      id: alert.id,
      alert_type: alert.alert_type,
      alert_level: alert.alert_level,
      start_time: alert.start_time,
      end_time: alert.end_time,
      duration_seconds: alert.duration_seconds,
      peak_temperature: this._getPeakTemp(alert),
      threshold: alert.threshold,
      deviation: Math.abs(alert.temperature - alert.threshold),
      status: alert.end_time ? 'closed' : 'open',
      acknowledged: alert.acknowledged === 1,
      acknowledged_by: alert.acknowledged_by,
      acknowledged_at: alert.acknowledged_at
    }));
  }

  static _getPeakTemp(alert) {
    return alert.temperature;
  }

  static acknowledge(id, acknowledged_by) {
    const db = getDb();
    db.prepare(`
      UPDATE alerts SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(acknowledged_by || 'system', id);
    return this.findById(id);
  }

  static getStatsByWaybill(waybill_no) {
    const alerts = this.findByWaybillNo(waybill_no);
    
    let total_count = 0;
    let open_count = 0;
    let critical_count = 0;
    let serious_count = 0;
    let warning_count = 0;
    let info_count = 0;
    let total_duration_seconds = 0;
    let max_duration_seconds = 0;

    for (const alert of alerts) {
      total_count++;
      if (!alert.end_time) open_count++;
      if (alert.alert_level === 'critical') critical_count++;
      else if (alert.alert_level === 'serious') serious_count++;
      else if (alert.alert_level === 'warning') warning_count++;
      else if (alert.alert_level === 'info') info_count++;
      
      const duration = Number(alert.duration_seconds) || 0;
      total_duration_seconds += duration;
      if (duration > max_duration_seconds) max_duration_seconds = duration;
    }

    return {
      total_count,
      open_count,
      by_level: {
        critical: critical_count,
        serious: serious_count,
        warning: warning_count,
        info: info_count
      },
      total_duration_seconds,
      max_duration_seconds
    };
  }
}

module.exports = AlertModel;
