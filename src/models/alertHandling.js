const { getDb } = require('../db');

const HANDLING_ACTIONS = {
  PROCESS: 'process',
  ESCALATE: 'escalate',
  REASSIGN: 'reassign',
  CONCLUDE: 'conclude'
};

class AlertHandlingModel {
  static create({ alert_id, action, handler_role, handler_name, result, remark, target_role }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO alert_handlings 
      (alert_id, action, handler_role, handler_name, result, remark, target_role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      alert_id, action, handler_role, handler_name || null,
      result || null, remark || null, target_role || null
    );
    return this.findById(res.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM alert_handlings WHERE id = ?').get(id);
  }

  static findByAlertId(alert_id) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM alert_handlings 
      WHERE alert_id = ? 
      ORDER BY created_at ASC
    `).all(alert_id);
  }

  static findByWaybillNo(waybill_no) {
    const db = getDb();
    const alerts = db.prepare(`
      SELECT id FROM alerts WHERE waybill_no = ?
    `).all(waybill_no);
    
    const allHandlings = [];
    for (const alert of alerts) {
      const handlings = this.findByAlertId(alert.id);
      allHandlings.push(...handlings);
    }
    return allHandlings;
  }

  static getHandlingSummary(alert_id) {
    const handlings = this.findByAlertId(alert_id);
    
    if (handlings.length === 0) {
      return {
        total_steps: 0,
        current_step: null,
        latest_handling: null,
        handling_chain: [],
        is_concluded: false
      };
    }

    const handlingChain = handlings.map(h => ({
      id: h.id,
      action: h.action,
      handler_role: h.handler_role,
      handler_name: h.handler_name,
      result: h.result,
      remark: h.remark,
      target_role: h.target_role,
      handled_at: h.created_at
    }));

    const latest = handlings[handlings.length - 1];
    const isConcluded = handlings.some(h => h.action === HANDLING_ACTIONS.CONCLUDE);

    return {
      total_steps: handlings.length,
      current_step: isConcluded ? 'concluded' : latest.action,
      latest_handling: {
        action: latest.action,
        handler_role: latest.handler_role,
        handler_name: latest.handler_name,
        handled_at: latest.created_at
      },
      handling_chain: handlingChain,
      is_concluded: isConcluded
    };
  }

  static processAlert(alert_id, { handler_role, handler_name, result, remark }) {
    return this.create({
      alert_id,
      action: HANDLING_ACTIONS.PROCESS,
      handler_role,
      handler_name,
      result,
      remark
    });
  }

  static escalateAlert(alert_id, { handler_role, handler_name, target_role, remark }) {
    return this.create({
      alert_id,
      action: HANDLING_ACTIONS.ESCALATE,
      handler_role,
      handler_name,
      remark,
      target_role
    });
  }

  static reassignAlert(alert_id, { handler_role, handler_name, target_role, remark }) {
    return this.create({
      alert_id,
      action: HANDLING_ACTIONS.REASSIGN,
      handler_role,
      handler_name,
      remark,
      target_role
    });
  }

  static concludeAlert(alert_id, { handler_role, handler_name, result, remark }) {
    const handling = this.create({
      alert_id,
      action: HANDLING_ACTIONS.CONCLUDE,
      handler_role,
      handler_name,
      result,
      remark
    });

    const AlertModel = require('./alert');
    AlertModel.acknowledge(alert_id, handler_name);

    return handling;
  }
}

module.exports = AlertHandlingModel;
module.exports.HANDLING_ACTIONS = HANDLING_ACTIONS;
