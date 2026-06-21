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
      query_type, waybill_no || null, caller_system || 'unknown',
      result_count || 0, ip_address || null
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM query_logs WHERE id = ?').get(id);
  }

  static findAll({ page = 1, page_size = 20, query_type, caller_system, startTime, endTime, waybill_no } = {}) {
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
    if (waybill_no) {
      clauses.push('waybill_no = ?');
      params.push(waybill_no);
    }
    if (startTime) {
      clauses.push('created_at >= ?');
      params.push(startTime);
    }
    if (endTime) {
      clauses.push('created_at <= ?');
      params.push(endTime);
    }
    
    const whereStr = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM query_logs ${whereStr}`).get(...params).cnt;
    const list = db.prepare(`
      SELECT * FROM query_logs ${whereStr}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, page_size, offset);
    
    return { list, total, page, page_size };
  }

  static getStats(days = 7) {
    const db = getDb();
    const allLogs = db.prepare('SELECT * FROM query_logs').all();
    
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const filtered = allLogs.filter(log => new Date(log.created_at).getTime() >= cutoffTime);
    
    const statsMap = new Map();
    for (const log of filtered) {
      const date = log.created_at ? log.created_at.split('T')[0] : 'unknown';
      const key = `${log.query_type}_${date}`;
      if (!statsMap.has(key)) {
        statsMap.set(key, {
          query_type: log.query_type,
          query_date: date,
          query_count: 0
        });
      }
      statsMap.get(key).query_count++;
    }
    
    return Array.from(statsMap.values())
      .sort((a, b) => {
        if (a.query_date !== b.query_date) {
          return b.query_date.localeCompare(a.query_date);
        }
        return a.query_type.localeCompare(b.query_type);
      });
  }

  static getStatsByCaller({ startTime, endTime } = {}) {
    const db = getDb();
    const allLogs = db.prepare('SELECT * FROM query_logs').all();
    
    const filtered = allLogs.filter(log => {
      const logTime = new Date(log.created_at).getTime();
      if (startTime && logTime < new Date(startTime).getTime()) return false;
      if (endTime && logTime > new Date(endTime).getTime()) return false;
      return true;
    });
    
    const statsMap = new Map();
    for (const log of filtered) {
      const key = `${log.caller_system}_${log.query_type}`;
      if (!statsMap.has(key)) {
        statsMap.set(key, {
          caller_system: log.caller_system || 'unknown',
          query_type: log.query_type,
          query_count: 0,
          total_results: 0,
          waybills: new Set()
        });
      }
      const entry = statsMap.get(key);
      entry.query_count++;
      entry.total_results += Number(log.result_count) || 0;
      if (log.waybill_no) {
        entry.waybills.add(log.waybill_no);
      }
    }
    
    return Array.from(statsMap.values())
      .map(e => ({
        caller_system: e.caller_system,
        query_type: e.query_type,
        query_count: e.query_count,
        total_results: e.total_results,
        unique_waybills: e.waybills.size
      }))
      .sort((a, b) => b.query_count - a.query_count);
  }

  static getStatsByType({ startTime, endTime } = {}) {
    const db = getDb();
    const allLogs = db.prepare('SELECT * FROM query_logs').all();
    
    const filtered = allLogs.filter(log => {
      const logTime = new Date(log.created_at).getTime();
      if (startTime && logTime < new Date(startTime).getTime()) return false;
      if (endTime && logTime > new Date(endTime).getTime()) return false;
      return true;
    });
    
    const statsMap = new Map();
    for (const log of filtered) {
      const key = log.query_type;
      if (!statsMap.has(key)) {
        statsMap.set(key, {
          query_type: key,
          query_count: 0,
          total_results: 0,
          results_list: []
        });
      }
      const entry = statsMap.get(key);
      entry.query_count++;
      entry.total_results += Number(log.result_count) || 0;
      entry.results_list.push(Number(log.result_count) || 0);
    }
    
    return Array.from(statsMap.values())
      .map(e => ({
        query_type: e.query_type,
        query_count: e.query_count,
        total_results: e.total_results,
        avg_results: e.query_count > 0 ? e.total_results / e.query_count : 0
      }))
      .sort((a, b) => b.query_count - a.query_count);
  }

  static getTopCallers({ limit = 10, startTime, endTime } = {}) {
    const db = getDb();
    const allLogs = db.prepare('SELECT * FROM query_logs').all();
    
    const filtered = allLogs.filter(log => {
      const logTime = new Date(log.created_at).getTime();
      if (startTime && logTime < new Date(startTime).getTime()) return false;
      if (endTime && logTime > new Date(endTime).getTime()) return false;
      return true;
    });
    
    const statsMap = new Map();
    for (const log of filtered) {
      const key = log.caller_system || 'unknown';
      if (!statsMap.has(key)) {
        statsMap.set(key, {
          caller_system: key,
          query_count: 0,
          total_results: 0,
          last_query_time: null
        });
      }
      const entry = statsMap.get(key);
      entry.query_count++;
      entry.total_results += Number(log.result_count) || 0;
      if (!entry.last_query_time || log.created_at > entry.last_query_time) {
        entry.last_query_time = log.created_at;
      }
    }
    
    return Array.from(statsMap.values())
      .sort((a, b) => b.query_count - a.query_count)
      .slice(0, limit);
  }

  static getSummary({ startTime, endTime } = {}) {
    const db = getDb();
    const allLogs = db.prepare('SELECT * FROM query_logs').all();
    
    const filtered = allLogs.filter(log => {
      const logTime = new Date(log.created_at).getTime();
      if (startTime && logTime < new Date(startTime).getTime()) return false;
      if (endTime && logTime > new Date(endTime).getTime()) return false;
      return true;
    });
    
    const callers = new Set();
    const waybills = new Set();
    let totalResults = 0;
    
    for (const log of filtered) {
      callers.add(log.caller_system || 'unknown');
      if (log.waybill_no) waybills.add(log.waybill_no);
      totalResults += Number(log.result_count) || 0;
    }

    return {
      total_queries: filtered.length,
      unique_callers: callers.size,
      unique_waybills: waybills.size,
      total_results: totalResults
    };
  }
}

module.exports = QueryLogModel;
