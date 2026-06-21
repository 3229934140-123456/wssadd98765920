const { getDb } = require('../db');
const AlertModel = require('./alert');

const HANDLING_ACTIONS = {
  PROCESS: 'process',
  ESCALATE: 'escalate',
  REASSIGN: 'reassign',
  CONCLUDE: 'conclude'
};

const ROLE_PERMISSIONS = {
  driver:     ['process'],
  dispatcher: ['process', 'reassign', 'escalate'],
  quality:    ['process', 'conclude'],
  admin:      ['process', 'reassign', 'escalate', 'conclude']
};

class AlertHandlingModel {
  static create({ alert_id, action, handler_role, handler_name, result, remark, target_role }) {
    this._checkPermission(handler_role, action);

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

  static _checkPermission(role, action) {
    const allowed = ROLE_PERMISSIONS[role];
    if (!allowed) {
      const err = new Error(`未知角色: ${role}，合法角色: driver, dispatcher, quality, admin`);
      err.code = 'UNKNOWN_ROLE';
      throw err;
    }
    if (!allowed.includes(action)) {
      const allowedStr = allowed.join(', ');
      const err = new Error(`角色 ${role} 没有权限执行 [${action}] 动作，允许的动作: ${allowedStr}`);
      err.code = 'ROLE_PERMISSION_DENIED';
      err.allowed_actions = allowed;
      throw err;
    }
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
    this._checkPermission(handler_role, HANDLING_ACTIONS.PROCESS);

    const alert = AlertModel.findById(alert_id);
    if (!alert) {
      const err = new Error('告警不存在');
      err.code = 'ALERT_NOT_FOUND';
      throw err;
    }

    if (alert.assignee && alert.assignee !== handler_role && alert.assignee !== 'admin') {
      const notified = alert.notify_roles ? alert.notify_roles.split(',').map(r => r.trim()) : [];
      if (!notified.includes(handler_role) && handler_role !== 'admin') {
        const err = new Error(`当前处理人为 ${alert.assignee}，${handler_role} 角色提交处理前需先由 ${alert.assignee} 转派`);
        err.code = 'NOT_ASSIGNED';
        err.current_assignee = alert.assignee;
        throw err;
      }
    }

    const handling = this.create({
      alert_id,
      action: HANDLING_ACTIONS.PROCESS,
      handler_role,
      handler_name,
      result,
      remark
    });

    return handling;
  }

  static escalateAlert(alert_id, { handler_role, handler_name, target_role, remark }) {
    this._checkPermission(handler_role, HANDLING_ACTIONS.ESCALATE);

    const alert = AlertModel.findById(alert_id);
    if (!alert) {
      const err = new Error('告警不存在');
      err.code = 'ALERT_NOT_FOUND';
      throw err;
    }
    if (!target_role) {
      const err = new Error('升级必须指定 target_role');
      err.code = 'MISSING_TARGET_ROLE';
      throw err;
    }

    const handling = this.create({
      alert_id,
      action: HANDLING_ACTIONS.ESCALATE,
      handler_role,
      handler_name,
      remark,
      target_role
    });

    AlertModel.setAssignee(alert_id, target_role);

    return handling;
  }

  static reassignAlert(alert_id, { handler_role, handler_name, target_role, remark }) {
    this._checkPermission(handler_role, HANDLING_ACTIONS.REASSIGN);

    const alert = AlertModel.findById(alert_id);
    if (!alert) {
      const err = new Error('告警不存在');
      err.code = 'ALERT_NOT_FOUND';
      throw err;
    }
    if (!target_role) {
      const err = new Error('转派必须指定 target_role');
      err.code = 'MISSING_TARGET_ROLE';
      throw err;
    }

    const handling = this.create({
      alert_id,
      action: HANDLING_ACTIONS.REASSIGN,
      handler_role,
      handler_name,
      remark,
      target_role
    });

    AlertModel.setAssignee(alert_id, target_role);

    return handling;
  }

  static concludeAlert(alert_id, { handler_role, handler_name, result, remark }) {
    this._checkPermission(handler_role, HANDLING_ACTIONS.CONCLUDE);

    const alert = AlertModel.findById(alert_id);
    if (!alert) {
      const err = new Error('告警不存在');
      err.code = 'ALERT_NOT_FOUND';
      throw err;
    }

    const handling = this.create({
      alert_id,
      action: HANDLING_ACTIONS.CONCLUDE,
      handler_role,
      handler_name,
      result,
      remark
    });

    AlertModel.markConcluded(alert_id);

    return handling;
  }
}

module.exports = AlertHandlingModel;
module.exports.HANDLING_ACTIONS = HANDLING_ACTIONS;
module.exports.ROLE_PERMISSIONS = ROLE_PERMISSIONS;
