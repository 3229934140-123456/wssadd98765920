const express = require('express');
const router = express.Router();
const TempRuleModel = require('../models/tempRule');

router.get('/', (req, res) => {
  try {
    const rules = TempRuleModel.findAll();
    res.json({
      success: true,
      data: rules.map(r => ({
        ...r,
        notify_roles: r.notify_roles ? r.notify_roles.split(',') : []
      }))
    });
  } catch (err) {
    console.error('查询温区规则失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const rule = TempRuleModel.findById(parseInt(req.params.id));
    if (!rule) {
      return res.status(404).json({ error: '规则不存在' });
    }
    res.json({
      success: true,
      data: {
        ...rule,
        notify_roles: rule.notify_roles ? rule.notify_roles.split(',') : []
      }
    });
  } catch (err) {
    console.error('查询规则失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.post('/', (req, res) => {
  try {
    const { product_type, product_name, min_temp, max_temp, 
            warning_min_temp, warning_max_temp, alert_level, 
            notify_roles, description } = req.body;

    if (!product_type || min_temp === undefined || max_temp === undefined) {
      return res.status(400).json({ error: '货品类型和温度上下限不能为空' });
    }

    if (min_temp >= max_temp) {
      return res.status(400).json({ error: '最低温度必须小于最高温度' });
    }

    const existing = TempRuleModel.findByProductType(product_type);
    if (existing) {
      return res.status(400).json({ error: '该货品类型规则已存在' });
    }

    const notifyRolesStr = Array.isArray(notify_roles) ? notify_roles.join(',') : notify_roles;

    const rule = TempRuleModel.create({
      product_type,
      product_name,
      min_temp: Number(min_temp),
      max_temp: Number(max_temp),
      warning_min_temp: warning_min_temp !== undefined ? Number(warning_min_temp) : null,
      warning_max_temp: warning_max_temp !== undefined ? Number(warning_max_temp) : null,
      alert_level: alert_level || 'warning',
      notify_roles: notifyRolesStr,
      description
    });

    res.status(201).json({
      success: true,
      data: {
        ...rule,
        notify_roles: rule.notify_roles ? rule.notify_roles.split(',') : []
      }
    });
  } catch (err) {
    console.error('创建规则失败:', err);
    res.status(500).json({ error: '创建失败', message: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const rule = TempRuleModel.findById(id);
    if (!rule) {
      return res.status(404).json({ error: '规则不存在' });
    }

    const updateData = { ...req.body };
    if (updateData.notify_roles && Array.isArray(updateData.notify_roles)) {
      updateData.notify_roles = updateData.notify_roles.join(',');
    }

    const updated = TempRuleModel.update(id, updateData);
    res.json({
      success: true,
      data: {
        ...updated,
        notify_roles: updated.notify_roles ? updated.notify_roles.split(',') : []
      }
    });
  } catch (err) {
    console.error('更新规则失败:', err);
    res.status(500).json({ error: '更新失败', message: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = TempRuleModel.delete(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: '规则不存在' });
    }
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('删除规则失败:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

module.exports = router;
