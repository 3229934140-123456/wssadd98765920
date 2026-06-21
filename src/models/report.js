const { getDb } = require('../db');

class ReportModel {
  static create({ report_no, waybill_no, report_data }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO reports 
      (report_no, waybill_no, report_data)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(
      report_no, waybill_no,
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

  static generateReportNo() {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `RPT-${dateStr}-${rand}`;
  }

  static getOrCreate(waybill_no, reportGenerator) {
    const existing = this.findByWaybillNo(waybill_no);
    
    if (existing.length > 0) {
      const latest = existing[0];
      const reportData = typeof latest.report_data === 'string' 
        ? JSON.parse(latest.report_data) 
        : latest.report_data;
      return {
        ...latest,
        report_data: reportData,
        is_new: false
      };
    }

    const reportData = reportGenerator();
    if (!reportData) return null;

    const reportNo = this.generateReportNo();
    const report = this.create({
      report_no: reportNo,
      waybill_no,
      report_data: reportData
    });

    const fullReport = this.findByReportNo(reportNo);
    const parsedData = typeof fullReport.report_data === 'string' 
      ? JSON.parse(fullReport.report_data) 
      : fullReport.report_data;

    return {
      ...fullReport,
      report_data: parsedData,
      is_new: true
    };
  }
}

module.exports = ReportModel;
