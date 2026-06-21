const { getDb } = require('../db');

class TransportTaskModel {
  static create({ waybill_no, plate_number, compartment_no, product_type, product_name, origin, destination, start_time }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO transport_tasks 
      (waybill_no, plate_number, compartment_no, product_type, product_name, origin, destination, start_time, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_transit')
    `);
    const result = stmt.run(
      waybill_no, plate_number, compartment_no, product_type, 
      product_name || null, origin || null, destination || null, 
      start_time || null
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM transport_tasks WHERE id = ?').get(id);
  }

  static findByWaybillNo(waybill_no) {
    const db = getDb();
    return db.prepare('SELECT * FROM transport_tasks WHERE waybill_no = ?').get(waybill_no);
  }

  static findActiveByDevice(plate_number, compartment_no) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM transport_tasks 
      WHERE plate_number = ? AND compartment_no = ? AND status = 'in_transit'
      ORDER BY created_at DESC LIMIT 1
    `).get(plate_number, compartment_no);
  }

  static findAll({ page = 1, page_size = 20, status, product_type } = {}) {
    const db = getDb();
    const offset = (page - 1) * page_size;
    
    const whereClauses = [];
    const params = [];
    if (status) {
      whereClauses.push('status = ?');
      params.push(status);
    }
    if (product_type) {
      whereClauses.push('product_type = ?');
      params.push(product_type);
    }
    
    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM transport_tasks ${whereStr}`).get(...params).cnt;
    const list = db.prepare(`
      SELECT * FROM transport_tasks ${whereStr}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, page_size, offset);
    
    return { list, total, page, page_size };
  }

  static update(id, data) {
    const db = getDb();
    const fields = [];
    const values = [];
    
    const allowed = ['plate_number', 'compartment_no', 'product_type', 'product_name', 
                     'origin', 'destination', 'start_time', 'end_time', 'status'];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(data[key]);
      }
    }
    
    if (fields.length === 0) return this.findById(id);
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    db.prepare(`UPDATE transport_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  static completeTask(waybill_no, end_time) {
    const db = getDb();
    const task = this.findByWaybillNo(waybill_no);
    if (!task) return null;
    
    db.prepare(`
      UPDATE transport_tasks 
      SET status = 'completed', end_time = ?, updated_at = CURRENT_TIMESTAMP
      WHERE waybill_no = ?
    `).run(end_time || new Date().toISOString(), waybill_no);
    
    return this.findByWaybillNo(waybill_no);
  }
}

module.exports = TransportTaskModel;
