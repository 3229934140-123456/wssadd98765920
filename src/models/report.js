const { getDb } = require('../db');

const REPORT_STATUS = {
  ACTIVE: 'active',
  DEPRECATED: 'deprecated',
  ARCHIVED: 'archived'
};

class ReportModel {
  static create({ report_no, waybill_no, version, status, report_data }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO reports 
      (report_no, waybill_no, version, status, report_data, replaced_by)
      VALUES (?, ?, ?, ?, ?, NULL)
    `);
    const result = stmt.run(
      report_no, waybill_no,
      version || 1,
      status || REPORT_STATUS.ACTIVE,
      typeof report_data === 'string' ? report_data : JSON.stringify(report_data)
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  }

  static findByReportNo(report_no) {
    const db = getDb();
    return db.prepare('SELECT * FROM reports WHERE report_no = ?').get(report_no);
  }

  static findByWaybillNo(waybill_no) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM reports 
      WHERE waybill_no = ? 
      ORDER BY created_at DESC
    `).all(waybill_no);
  }

  static findActiveByWaybillNo(waybill_no) {
    const all = this.findByWaybillNo(waybill_no);
    return all.find(r => r.status === REPORT_STATUS.ACTIVE) || null;
  }

  static getLatestVersion(waybill_no) {
    const all = this.findByWaybillNo(waybill_no);
    if (all.length === 0) return 0;
    return Math.max(...all.map(r => Number(r.version) || 1));
  }

  static generateReportNo() {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `RPT-${dateStr}-${rand}`;
  }

  static markReplaced(oldReportId, newReportNo) {
    const db = getDb();
    db.prepare(`
      UPDATE reports SET status = ?, replaced_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(REPORT_STATUS.DEPRECATED, newReportNo, oldReportId);
    return this.findById(oldReportId);
  }

  static deprecate(report_id) {
    const db = getDb();
    db.prepare(`
      UPDATE reports SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(REPORT_STATUS.DEPRECATED, report_id);
    return this.findById(report_id);
  }

  static createNewVersion(waybill_no, reportData) {
    const db = getDb();
    const currentActive = this.findActiveByWaybillNo(waybill_no);
    const newVersion = this.getLatestVersion(waybill_no) + 1;
    const newReportNo = this.generateReportNo();

    if (currentActive) {
      this.markReplaced(currentActive.id, newReportNo);
    }

    const newReport = this.create({
      report_no: newReportNo,
      waybill_no,
      version: newVersion,
      status: REPORT_STATUS.ACTIVE,
      report_data: reportData
    });

    return newReport;
  }

  static getVersionChain(waybill_no) {
    const all = this.findByWaybillNo(waybill_no);
    return all.map(r => ({
      report_no: r.report_no,
      version: Number(r.version) || 1,
      status: r.status,
      replaced_by: r.replaced_by,
      created_at: r.created_at,
      is_current: r.status === REPORT_STATUS.ACTIVE,
      is_deprecated: r.status === REPORT_STATUS.DEPRECATED
    }));
  }
}

module.exports = ReportModel;
module.exports.REPORT_STATUS = REPORT_STATUS;
