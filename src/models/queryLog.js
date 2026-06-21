const { getDb } = require('../db');

class QueryLogModel {
  static create({ query_type, waybill_no, caller_system, result_count, ip_address }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO query_logs 
      (query_type, waybill_no, caller_system, result_count, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      query_type, waybill_no || null, caller_system || null,
      result_count || 0, ip_address || null
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM query_logs WHERE id = ?').get(id);
  }

  static findAll({ page = 1, page_size = 20, query_type, caller_system, startTime, endTime } = {}) {
    const db = getDb();
    const offset = (page - 1) * page_size;
    
    const clauses = [];
    const params = [];
    if (query_type) {
      clauses.push('query_type = ?');
      params.push(query_type);
    }
    if (caller_system) {
      clauses.push('caller_system = ?');
      params.push(caller_system);
    }
    if (startTime) {
      clauses.push('query_time >= ?');
      params.push(startTime);
    }
    if (endTime) {
      clauses.push('query_time <= ?');
      params.push(endTime);
    }
    
    const whereStr = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM query_logs ${whereStr}`).get(...params).cnt;
    const list = db.prepare(`
      SELECT * FROM query_logs ${whereStr}
      ORDER BY query_time DESC LIMIT ? OFFSET ?
    `).all(...params, page_size, offset);
    
    return { list, total, page, page_size };
  }

  static getStats(days = 7) {
    const db = getDb();
    return db.prepare(`
      SELECT 
        query_type,
        COUNT(*) as query_count,
        DATE(query_time) as query_date
      FROM query_logs
      WHERE query_time >= datetime('now', ?)
      GROUP BY query_type, DATE(query_time)
      ORDER BY query_date DESC, query_type
    `).all(`-${days} days`);
  }
}

module.exports = QueryLogModel;
