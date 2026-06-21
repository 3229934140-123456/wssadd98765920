const { getDb } = require('../db');

class AlertModel {
  static create({ waybill_no, device_no, alert_type, alert_level, temperature, 
                  threshold, start_time, notify_roles }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO alerts 
      (waybill_no, device_no, alert_type, alert_level, temperature, threshold, start_time, notify_roles)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

  static findAll({ page = 1, page_size = 20, alert_level, acknowledged } = {}) {
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
    
    const whereStr = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM alerts ${whereStr}`).get(...params).cnt;
    const list = db.prepare(`
      SELECT * FROM alerts ${whereStr}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, page_size, offset);
    
    return { list, total, page, page_size };
  }

  static acknowledge(id, acknowledged_by) {
    const db = getDb();
    db.prepare(`
      UPDATE alerts SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(acknowledged_by || 'system', id);
    return this.findById(id);
  }
}

module.exports = AlertModel;
