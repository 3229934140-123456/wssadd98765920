const { getDb } = require('../db');

class DeviceModel {
  static create({ device_no, plate_number, compartment_no, status = 'active', vendor }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO devices (device_no, plate_number, compartment_no, status, vendor)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(device_no, plate_number, compartment_no, status, vendor || null);
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  }

  static findByDeviceNo(device_no) {
    const db = getDb();
    return db.prepare('SELECT * FROM devices WHERE device_no = ?').get(device_no);
  }

  static findAll({ page = 1, page_size = 20, status } = {}) {
    const db = getDb();
    const offset = (page - 1) * page_size;
    
    let whereClause = '';
    const params = [];
    if (status) {
      whereClause = 'WHERE status = ?';
      params.push(status);
    }
    
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM devices ${whereClause}`).get(...params).cnt;
    const list = db.prepare(`
      SELECT * FROM devices ${whereClause}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, page_size, offset);
    
    return { list, total, page, page_size };
  }

  static update(id, data) {
    const db = getDb();
    const fields = [];
    const values = [];
    
    const allowed = ['plate_number', 'compartment_no', 'status', 'vendor'];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(data[key]);
      }
    }
    
    if (fields.length === 0) return this.findById(id);
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    db.prepare(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  static delete(id) {
    const db = getDb();
    return db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  }
}

module.exports = DeviceModel;
