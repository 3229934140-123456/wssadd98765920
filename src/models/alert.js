const { getDb } = require('../db');

const FLOW_STATUS = {
  NOTIFIED: 'notified',
  REASSIGNED: 'reassigned',
  CONCLUDED: 'concluded'
};

class AlertModel {
  static create({ waybill_no, device_no, alert_type, alert_level, temperature,
                  threshold, start_time, notify_roles }) {
    const db = getDb();
    
    const roleList = notify_roles ? notify_roles.split(',').map(r => r.trim()).filter(Boolean) : [];
    const assignee = roleList.includes('quality') ? 'quality'
                   : roleList.includes('dispatcher') ? 'dispatcher'
                   : roleList.includes('driver') ? 'driver'
                   : null;
    const involvedRoles = roleList.length > 0 ? roleList.join(',') : null;

    const stmt = db.prepare(`
      INSERT INTO alerts 
      (waybill_no, device_no, alert_type, alert_level, temperature, threshold, start_time, notify_roles, duration_seconds, acknowledged, assignee, flow_status, involved_roles)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
    `);
    const result = stmt.run(
      waybill_no || null, device_no, alert_type, alert_level,
      temperature, threshold, start_time, notify_roles || null,
      assignee, FLOW_STATUS.NOTIFIED, involvedRoles
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
        UPDATE alerts SET duration_seconds = ?, end_time = ?, temperature = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(duration_seconds, end_time, current_temp, id);
    } else {
      db.prepare(`
        UPDATE alerts SET duration_seconds = ?, temperature = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(duration_seconds, current_temp, id);
    }
    return this.findById(id);
  }

  static setAssignee(id, assignee, flow_status = FLOW_STATUS.REASSIGNED) {
    const db = getDb();
    const alert = this.findById(id);
    if (!alert) return null;

    const involved = alert.involved_roles ? alert.involved_roles.split(',').map(r => r.trim()) : [];
    if (!involved.includes(assignee)) {
      involved.push(assignee);
    }

    db.prepare(`
      UPDATE alerts SET assignee = ?, flow_status = ?, involved_roles = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(assignee, flow_status, involved.join(','), id);
    return this.findById(id);
  }

  static markConcluded(id) {
    const db = getDb();
    db.prepare(`
      UPDATE alerts SET flow_status = ?, acknowledged = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(FLOW_STATUS.CONCLUDED, id);
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

  static findByRole(role, { page = 1, page_size = 20, status, alert_level, startTime, endTime, view = 'all' } = {}) {
    const db = getDb();
    
    const allAlerts = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all();
    
    let filtered = allAlerts.filter(alert => {
      const roles = alert.notify_roles ? alert.notify_roles.split(',').map(r => r.trim()) : [];
      const involved = alert.involved_roles ? alert.involved_roles.split(',').map(r => r.trim()) : [];

      if (view === 'assigned' || view === 'todo') {
        if (alert.assignee !== role) return false;
        if (alert.flow_status === FLOW_STATUS.CONCLUDED) return false;
      } else if (view === 'involved') {
        if (!involved.includes(role)) return false;
      } else {
        if (!involved.includes(role) && !roles.includes(role)) return false;
      }
      
      if (alert_level && alert.alert_level !== alert_level) return false;
      if (status === 'open' && alert.end_time !== null && alert.end_time !== undefined) return false;
      if (status === 'closed' && (alert.end_time === null || alert.end_time === undefined)) return false;
      if (status === 'unacknowledged' && alert.acknowledged === 1) return false;
      if (status === 'acknowledged' && alert.acknowledged !== 1) return false;
      if (status === 'notified' && alert.flow_status !== FLOW_STATUS.NOTIFIED) return false;
      if (status === 'reassigned' && alert.flow_status !== FLOW_STATUS.REASSIGNED) return false;
      if (status === 'concluded' && alert.flow_status !== FLOW_STATUS.CONCLUDED) return false;
      if (startTime && alert.start_time < startTime) return false;
      if (endTime && alert.start_time > endTime) return false;
      
      return true;
    });
    
    const total = filtered.length;
    const offset = (page - 1) * page_size;
    const list = filtered.slice(offset, offset + page_size);
    
    return { list, total, page, page_size };
  }

  static getTodoAlerts(role, { page = 1, page_size = 20, alert_level } = {}) {
    return this.findByRole(role, { page, page_size, alert_level, view: 'todo' });
  }

  static getInvolvedAlerts(role, { page = 1, page_size = 20 } = {}) {
    return this.findByRole(role, { page, page_size, view: 'involved' });
  }

  static findAll({ page = 1, page_size = 20, alert_level, acknowledged, status, startTime, endTime, flow_status, role } = {}) {
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
    if (flow_status) {
      clauses.push('flow_status = ?');
      params.push(flow_status);
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
    
    let allRows = db.prepare(`SELECT * FROM alerts ${whereStr} ORDER BY start_time DESC`).all(...params);
    
    if (role) {
      allRows = allRows.filter(a => {
        const involved = a.involved_roles ? a.involved_roles.split(',').map(r => r.trim()) : [];
        const notified = a.notify_roles ? a.notify_roles.split(',').map(r => r.trim()) : [];
        return involved.includes(role) || notified.includes(role);
      });
    }
    
    const total = allRows.length;
    const list = allRows.slice(offset, offset + page_size);
    
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
      flow_status: alert.flow_status,
      assignee: alert.assignee,
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
      UPDATE alerts SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
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
    let not_concluded_count = 0;
    let reassigned_count = 0;

    for (const alert of alerts) {
      total_count++;
      if (!alert.end_time) open_count++;
      if (alert.flow_status !== FLOW_STATUS.CONCLUDED) not_concluded_count++;
      if (alert.flow_status === FLOW_STATUS.REASSIGNED) reassigned_count++;
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
      by_flow: {
        notified: alerts.filter(a => a.flow_status === FLOW_STATUS.NOTIFIED).length,
        reassigned: reassigned_count,
        concluded: alerts.filter(a => a.flow_status === FLOW_STATUS.CONCLUDED).length
      },
      not_concluded_count,
      total_duration_seconds,
      max_duration_seconds
    };
  }

  static getAlertsGroupedByFlow(waybill_no) {
    const alerts = this.findByWaybillNo(waybill_no);
    const groups = {
      notified: { label: '通知过', status: FLOW_STATUS.NOTIFIED, list: [] },
      reassigned: { label: '转派中', status: FLOW_STATUS.REASSIGNED, list: [] },
      concluded: { label: '已结论', status: FLOW_STATUS.CONCLUDED, list: [] }
    };

    for (const alert of alerts) {
      const status = alert.flow_status || FLOW_STATUS.NOTIFIED;
      if (groups[status]) {
        groups[status].list.push(alert);
      }
    }

    const summary = {};
    for (const [key, group] of Object.entries(groups)) {
      summary[key] = group.list.length;
    }

    return { summary, groups };
  }
}

module.exports = AlertModel;
module.exports.FLOW_STATUS = FLOW_STATUS;
