const { getDb } = require('../db');

class TemperatureRecordModel {
  static create({ device_no, plate_number, compartment_no, waybill_no, temperature, 
                  humidity, location_lat, location_lng, location_text, record_time }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO temperature_records 
      (device_no, plate_number, compartment_no, waybill_no, temperature, humidity, 
       location_lat, location_lng, location_text, record_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      device_no, plate_number, compartment_no, waybill_no || null,
      temperature, humidity || null, location_lat || null, location_lng || null,
      location_text || null, record_time
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM temperature_records WHERE id = ?').get(id);
  }

  static findByWaybillNo(waybill_no, { page = 1, page_size = 100, order = 'asc' } = {}) {
    const db = getDb();
    const offset = (page - 1) * page_size;
    const orderDir = order === 'desc' ? 'DESC' : 'ASC';
    
    const total = db.prepare('SELECT COUNT(*) as cnt FROM temperature_records WHERE waybill_no = ?')
      .get(waybill_no).cnt;
    
    const list = db.prepare(`
      SELECT * FROM temperature_records 
      WHERE waybill_no = ? 
      ORDER BY record_time ${orderDir}
      LIMIT ? OFFSET ?
    `).all(waybill_no, page_size, offset);
    
    return { list, total, page, page_size };
  }

  static findByDevice(device_no, { startTime, endTime, limit = 100 } = {}) {
    const db = getDb();
    const clauses = ['device_no = ?'];
    const params = [device_no];
    
    if (startTime) {
      clauses.push('record_time >= ?');
      params.push(startTime);
    }
    if (endTime) {
      clauses.push('record_time <= ?');
      params.push(endTime);
    }
    
    return db.prepare(`
      SELECT * FROM temperature_records 
      WHERE ${clauses.join(' AND ')}
      ORDER BY record_time ASC
      LIMIT ?
    `).all(...params, limit);
  }

  static getStatsByWaybill(waybill_no) {
    const db = getDb();
    return db.prepare(`
      SELECT 
        COUNT(*) as record_count,
        MIN(temperature) as min_temp,
        MAX(temperature) as max_temp,
        AVG(temperature) as avg_temp,
        MIN(record_time) as first_record_time,
        MAX(record_time) as last_record_time
      FROM temperature_records
      WHERE waybill_no = ?
    `).get(waybill_no);
  }

  static getLatestByDevice(device_no) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM temperature_records 
      WHERE device_no = ?
      ORDER BY record_time DESC LIMIT 1
    `).get(device_no);
  }
}

module.exports = TemperatureRecordModel;
