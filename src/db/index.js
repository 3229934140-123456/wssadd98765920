const fs = require('fs');
const path = require('path');
const config = require('../config');

class JsonDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {
      devices: [],
      transport_tasks: [],
      temperature_records: [],
      temp_rules: [],
      alerts: [],
      query_logs: []
    };
    this.counters = {
      devices: 0,
      transport_tasks: 0,
      temperature_records: 0,
      temp_rules: 0,
      alerts: 0,
      query_logs: 0
    };
    this._loaded = false;
  }

  _load() {
    if (this._loaded) return;
    
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = parsed.data || this.data;
        this.counters = parsed.counters || this.counters;
      }
    } catch (err) {
      console.warn('数据库文件加载失败，使用空数据库:', err.message);
    }
    
    this._loaded = true;
    this._seedDefaultRules();
  }

  _save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify({
      data: this.data,
      counters: this.counters
    }, null, 2));
  }

  _seedDefaultRules() {
    if (this.data.temp_rules.length === 0) {
      const rules = [
        { product_type: 'frozen_meat', product_name: '冷冻肉类', min_temp: -18, max_temp: -12, warning_min_temp: -16, warning_max_temp: -14, alert_level: 'serious', notify_roles: 'quality,dispatcher,driver', description: '冷冻肉品需严格保持在-18℃以下' },
        { product_type: 'vaccine', product_name: '疫苗', min_temp: 2, max_temp: 8, warning_min_temp: 3, warning_max_temp: 7, alert_level: 'critical', notify_roles: 'quality,dispatcher,driver,manager', description: '疫苗冷链要求最严格，偏差需立即处理' },
        { product_type: 'dairy', product_name: '乳制品', min_temp: 0, max_temp: 6, warning_min_temp: 1, warning_max_temp: 5, alert_level: 'warning', notify_roles: 'dispatcher,driver', description: '乳制品需冷藏保存' },
        { product_type: 'fresh_fruit', product_name: '新鲜水果', min_temp: 4, max_temp: 10, warning_min_temp: 5, warning_max_temp: 9, alert_level: 'warning', notify_roles: 'dispatcher,driver', description: '水果保鲜温度范围' },
        { product_type: 'seafood', product_name: '海鲜水产', min_temp: -2, max_temp: 4, warning_min_temp: 0, warning_max_temp: 2, alert_level: 'serious', notify_roles: 'quality,dispatcher,driver', description: '海鲜需低温保鲜' }
      ];
      
      rules.forEach((rule, i) => {
        const now = new Date().toISOString();
        this.data.temp_rules.push({
          id: i + 1,
          ...rule,
          created_at: now,
          updated_at: now
        });
      });
      this.counters.temp_rules = rules.length;
      this._save();
    }
  }

  _nextId(table) {
    this.counters[table] = (this.counters[table] || 0) + 1;
    return this.counters[table];
  }

  pragma() {}

  exec() {}

  prepare(sql) {
    this._load();
    return new Statement(this, sql);
  }

  close() {
    this._save();
  }
}

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.trim();
    this.conditions = [];
    this.selectFields = [];
    this.hasAggregates = false;
    this._parse();
  }

  _parse() {
    const sql = this.sql.toLowerCase();
    
    if (sql.startsWith('select')) {
      this.type = 'select';
      this._parseSelect();
    } else if (sql.startsWith('insert')) {
      this.type = 'insert';
      this._parseInsert();
    } else if (sql.startsWith('update')) {
      this.type = 'update';
      this._parseUpdate();
    } else if (sql.startsWith('delete')) {
      this.type = 'delete';
      this._parseDelete();
    }
  }

  _parseSelect() {
    const sqlSingle = this.sql.replace(/\s+/g, ' ').trim();
    
    const selectMatch = sqlSingle.match(/select\s+(.+?)\s+from/i);
    if (selectMatch) {
      this.selectFields = this._parseSelectFields(selectMatch[1]);
      this.hasAggregates = this.selectFields.some(f => f.aggregate);
      if (this.hasAggregates) {
        this.type = 'aggregate';
      }
    }

    const fromMatch = sqlSingle.match(/from\s+(\w+)/i);
    if (fromMatch) {
      this.table = fromMatch[1];
    }
    
    const whereMatch = sqlSingle.match(/where\s+(.+?)(?:order\s+by|limit|$)/i);
    if (whereMatch) {
      this.conditions = this._parseConditions(whereMatch[1].trim());
    }
    
    const orderMatch = sqlSingle.match(/order\s+by\s+(.+?)(?:limit|$)/i);
    if (orderMatch) {
      this.orderBy = orderMatch[1].trim();
    }
    
    const limitMatch = sqlSingle.match(/limit\s+(\d+)/i);
    if (limitMatch) {
      this.limit = parseInt(limitMatch[1]);
    }
    
    const offsetMatch = sqlSingle.match(/offset\s+(\d+)/i);
    if (offsetMatch) {
      this.offset = parseInt(offsetMatch[1]);
    }
  }

  _parseSelectFields(fieldsStr) {
    const fields = [];
    const parts = fieldsStr.split(',').map(s => s.trim());
    
    for (const part of parts) {
      const aggMatch = part.match(/(count|min|max|avg|sum)\s*\(\s*(.+?)\s*\)\s+as\s+(\w+)/i);
      if (aggMatch) {
        fields.push({
          aggregate: aggMatch[1].toLowerCase(),
          field: aggMatch[2] === '*' ? null : aggMatch[2],
          alias: aggMatch[3]
        });
      } else {
        const asMatch = part.match(/(.+?)\s+as\s+(\w+)/i);
        if (asMatch) {
          fields.push({ aggregate: null, field: asMatch[1], alias: asMatch[2] });
        } else {
          fields.push({ aggregate: null, field: part, alias: part });
        }
      }
    }
    
    return fields;
  }

  _parseConditions(whereStr) {
    const conditions = [];
    const parts = whereStr.split(/\s+and\s+/i);
    
    for (const part of parts) {
      const trimmed = part.trim();
      
      const eqMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/i);
      if (eqMatch) {
        const field = eqMatch[1];
        const valueExpr = eqMatch[2].trim();
        conditions.push({
          field,
          operator: '=',
          ...this._parseValueExpr(valueExpr)
        });
        continue;
      }
      
      const isNullMatch = trimmed.match(/^(\w+)\s+is\s+null$/i);
      if (isNullMatch) {
        conditions.push({
          field: isNullMatch[1],
          operator: 'is_null',
          valueType: 'literal',
          value: null
        });
        continue;
      }
      
      const isNotNullMatch = trimmed.match(/^(\w+)\s+is\s+not\s+null$/i);
      if (isNotNullMatch) {
        conditions.push({
          field: isNotNullMatch[1],
          operator: 'is_not_null',
          valueType: 'literal',
          value: null
        });
        continue;
      }
    }
    
    return conditions;
  }

  _parseValueExpr(expr) {
    if (expr === '?') {
      return { valueType: 'param', value: null };
    }
    if (expr.toUpperCase() === 'CURRENT_TIMESTAMP') {
      return { valueType: 'literal', value: new Date().toISOString() };
    }
    if ((expr.startsWith("'") && expr.endsWith("'")) || (expr.startsWith('"') && expr.endsWith('"'))) {
      return { valueType: 'literal', value: expr.slice(1, -1) };
    }
    if (!isNaN(Number(expr)) && expr !== '') {
      return { valueType: 'literal', value: Number(expr) };
    }
    if (expr.toUpperCase() === 'NULL') {
      return { valueType: 'literal', value: null };
    }
    return { valueType: 'literal', value: expr };
  }

  _parseInsert() {
    const sqlSingle = this.sql.replace(/\s+/g, ' ').trim();
    
    const tableMatch = sqlSingle.match(/into\s+(\w+)/i);
    if (tableMatch) {
      this.table = tableMatch[1];
    }
    
    const columnsMatch = sqlSingle.match(/\(([^)]+)\)/);
    if (columnsMatch) {
      this.columns = columnsMatch[1].split(',').map(s => s.trim());
    }
    
    const valuesMatch = sqlSingle.match(/values\s*\(([^)]+)\)/i);
    if (valuesMatch) {
      this.valueExprs = valuesMatch[1].split(',').map(s => s.trim());
    }
  }

  _parseUpdate() {
    const sqlSingle = this.sql.replace(/\s+/g, ' ').trim();
    
    const tableMatch = sqlSingle.match(/update\s+(\w+)/i);
    if (tableMatch) {
      this.table = tableMatch[1];
    }
    
    const setMatch = sqlSingle.match(/set\s+(.+?)\s+where/i);
    if (setMatch) {
      this.setClause = setMatch[1].trim();
      this.setValues = this._parseSetClause(this.setClause);
    }
    
    const whereMatch = sqlSingle.match(/where\s+(.+)$/i);
    if (whereMatch) {
      this.conditions = this._parseConditions(whereMatch[1].trim());
    }
  }

  _parseSetClause(clause) {
    const result = [];
    const parts = clause.split(',').map(s => s.trim());
    
    for (const part of parts) {
      const m = part.match(/^(\w+)\s*=\s*(.+)$/i);
      if (m) {
        const fieldName = m[1];
        const valueExpr = m[2].trim();
        const parsed = this._parseValueExpr(valueExpr);
        result.push({ field: fieldName, ...parsed });
      }
    }
    
    return result;
  }

  _parseDelete() {
    const sqlSingle = this.sql.replace(/\s+/g, ' ').trim();
    
    const fromMatch = sqlSingle.match(/from\s+(\w+)/i);
    if (fromMatch) {
      this.table = fromMatch[1];
    }
    
    const whereMatch = sqlSingle.match(/where\s+(.+)$/i);
    if (whereMatch) {
      this.conditions = this._parseConditions(whereMatch[1].trim());
    }
  }

  _evalConditions(row, params) {
    let paramIdx = 0;
    
    for (const cond of this.conditions) {
      const rowVal = row[cond.field];
      let compareVal;
      
      if (cond.valueType === 'param') {
        compareVal = params[paramIdx++];
      } else {
        compareVal = cond.value;
      }
      
      if (cond.operator === '=') {
        if (!this._valuesEqual(rowVal, compareVal)) {
          return false;
        }
      } else if (cond.operator === 'is_null') {
        if (rowVal !== null && rowVal !== undefined) {
          return false;
        }
      } else if (cond.operator === 'is_not_null') {
        if (rowVal === null || rowVal === undefined) {
          return false;
        }
      }
    }
    
    return true;
  }

  _valuesEqual(a, b) {
    if (a === null || a === undefined) {
      return b === null || b === undefined;
    }
    if (b === null || b === undefined) {
      return false;
    }
    return String(a) === String(b);
  }

  _applyOrderBy(rows) {
    if (!this.orderBy) return rows;
    
    const parts = this.orderBy.split(/\s+/);
    const field = parts[0];
    const dir = parts[1]?.toLowerCase() === 'desc' ? -1 : 1;
    
    return [...rows].sort((a, b) => {
      if (a[field] < b[field]) return -1 * dir;
      if (a[field] > b[field]) return 1 * dir;
      return 0;
    });
  }

  _computeAggregates(rows) {
    const result = {};
    
    for (const field of this.selectFields) {
      if (!field.aggregate) continue;
      
      switch (field.aggregate) {
        case 'count':
          result[field.alias] = rows.length;
          break;
        case 'min':
          if (rows.length === 0) {
            result[field.alias] = null;
          } else {
            const values = rows.map(r => r[field.field]).filter(v => v !== undefined && v !== null);
            if (values.length === 0) {
              result[field.alias] = null;
            } else if (values.every(v => !isNaN(Number(v)))) {
              result[field.alias] = Math.min(...values.map(v => Number(v)));
            } else {
              result[field.alias] = values.sort()[0];
            }
          }
          break;
        case 'max':
          if (rows.length === 0) {
            result[field.alias] = null;
          } else {
            const values = rows.map(r => r[field.field]).filter(v => v !== undefined && v !== null);
            if (values.length === 0) {
              result[field.alias] = null;
            } else if (values.every(v => !isNaN(Number(v)))) {
              result[field.alias] = Math.max(...values.map(v => Number(v)));
            } else {
              result[field.alias] = values.sort().reverse()[0];
            }
          }
          break;
        case 'avg':
          if (rows.length === 0) {
            result[field.alias] = null;
          } else {
            const sum = rows.reduce((acc, r) => acc + Number(r[field.field] || 0), 0);
            result[field.alias] = sum / rows.length;
          }
          break;
        case 'sum':
          if (rows.length === 0) {
            result[field.alias] = 0;
          } else {
            result[field.alias] = rows.reduce((acc, r) => acc + Number(r[field.field] || 0), 0);
          }
          break;
      }
    }
    
    return result;
  }

  get(...params) {
    const rows = this.all(...params);
    return rows[0];
  }

  all(...params) {
    let rows = this.db.data[this.table] || [];
    
    rows = rows.filter(row => this._evalConditions(row, params));
    
    if (this.hasAggregates) {
      return [this._computeAggregates(rows)];
    }
    
    rows = this._applyOrderBy(rows);
    
    if (this.offset) {
      rows = rows.slice(this.offset);
    }
    if (this.limit !== undefined) {
      rows = rows.slice(0, this.limit);
    }
    
    return rows;
  }

  run(...params) {
    const now = new Date().toISOString();
    let paramIdx = 0;

    if (this.type === 'insert') {
      const id = this.db._nextId(this.table);
      const row = { id };
      
      for (let i = 0; i < this.columns.length; i++) {
        const col = this.columns[i];
        const valExpr = this.valueExprs[i];
        
        if (col === 'created_at' || col === 'updated_at') {
          row[col] = now;
        } else if (valExpr === '?') {
          row[col] = params[paramIdx++];
        } else if (valExpr.toUpperCase() === 'CURRENT_TIMESTAMP') {
          row[col] = now;
        } else if ((valExpr.startsWith("'") && valExpr.endsWith("'")) || 
                   (valExpr.startsWith('"') && valExpr.endsWith('"'))) {
          row[col] = valExpr.slice(1, -1);
        } else if (!isNaN(Number(valExpr)) && valExpr !== '') {
          row[col] = Number(valExpr);
        } else if (valExpr.toUpperCase() === 'NULL') {
          row[col] = null;
        } else {
          row[col] = valExpr;
        }
      }
      
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      
      this.db.data[this.table].push(row);
      this.db._save();
      
      return { lastInsertRowid: id, changes: 1 };
    }
    
    if (this.type === 'update') {
      let changes = 0;
      let setParamIdx = 0;
      const setValues = [];
      
      for (const sv of this.setValues) {
        if (sv.valueType === 'param') {
          setValues.push({ field: sv.field, value: params[setParamIdx++] });
        } else {
          setValues.push({ field: sv.field, value: sv.value });
        }
      }
      
      const whereParams = params.slice(setParamIdx);
      
      for (const row of this.db.data[this.table]) {
        if (this._evalConditions(row, whereParams)) {
          for (const { field, value } of setValues) {
            row[field] = value;
          }
          row.updated_at = now;
          changes++;
        }
      }
      
      if (changes > 0) this.db._save();
      return { changes };
    }
    
    if (this.type === 'delete') {
      const before = this.db.data[this.table].length;
      
      this.db.data[this.table] = this.db.data[this.table].filter(row => {
        return !this._evalConditions(row, params);
      });
      
      const changes = before - this.db.data[this.table].length;
      if (changes > 0) this.db._save();
      return { changes };
    }
    
    return { changes: 0 };
  }
}

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new JsonDatabase(config.db.path);
  }
  return dbInstance;
}

module.exports = { getDb };
