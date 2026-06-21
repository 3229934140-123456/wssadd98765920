const { getDb } = require('../db');

class TempRuleModel {
  static create({ product_type, product_name, min_temp, max_temp, warning_min_temp, warning_max_temp, alert_level, notify_roles, description }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO temp_rules 
      (product_type, product_name, min_temp, max_temp, warning_min_temp, warning_max_temp, alert_level, notify_roles, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      product_type, product_name || null, min_temp, max_temp,
      warning_min_temp !== undefined ? warning_min_temp : null,
      warning_max_temp !== undefined ? warning_max_temp : null,
      alert_level || 'warning',
      notify_roles || null,
      description || null
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM temp_rules WHERE id = ?').get(id);
  }

  static findByProductType(product_type) {
    const db = getDb();
    return db.prepare('SELECT * FROM temp_rules WHERE product_type = ?').get(product_type);
  }

  static findAll() {
    const db = getDb();
    return db.prepare('SELECT * FROM temp_rules ORDER BY created_at DESC').all();
  }

  static update(id, data) {
    const db = getDb();
    const fields = [];
    const values = [];
    
    const allowed = ['product_name', 'min_temp', 'max_temp', 'warning_min_temp', 
                     'warning_max_temp', 'alert_level', 'notify_roles', 'description'];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(data[key]);
      }
    }
    
    if (fields.length === 0) return this.findById(id);
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    db.prepare(`UPDATE temp_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  static delete(id) {
    const db = getDb();
    return db.prepare('DELETE FROM temp_rules WHERE id = ?').run(id);
  }
}

module.exports = TempRuleModel;
