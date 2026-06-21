const express = require('express');
const router = express.Router();
const TransportTaskModel = require('../models/transportTask');

router.get('/', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const page_size = parseInt(req.query.page_size) || 20;
    const status = req.query.status;
    const product_type = req.query.product_type;

    const result = TransportTaskModel.findAll({ page, page_size, status, product_type });
    
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('查询运输任务失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/:waybill_no', (req, res) => {
  try {
    const task = TransportTaskModel.findByWaybillNo(req.params.waybill_no);
    if (!task) {
      return res.status(404).json({ error: '运输任务不存在' });
    }
    res.json({ success: true, data: task });
  } catch (err) {
    console.error('查询运输任务失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.post('/', (req, res) => {
  try {
    const { waybill_no, plate_number, compartment_no, product_type, 
            product_name, origin, destination, start_time } = req.body;

    if (!waybill_no || !plate_number || !compartment_no || !product_type) {
      return res.status(400).json({ error: '运单号、车牌、车厢编号和货品类型不能为空' });
    }

    const existing = TransportTaskModel.findByWaybillNo(waybill_no);
    if (existing) {
      return res.status(400).json({ error: '运单号已存在' });
    }

    const task = TransportTaskModel.create({
      waybill_no,
      plate_number,
      compartment_no,
      product_type,
      product_name,
      origin,
      destination,
      start_time: start_time || new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      data: task
    });
  } catch (err) {
    console.error('创建运输任务失败:', err);
    res.status(500).json({ error: '创建失败', message: err.message });
  }
});

router.put('/:waybill_no', (req, res) => {
  try {
    const task = TransportTaskModel.findByWaybillNo(req.params.waybill_no);
    if (!task) {
      return res.status(404).json({ error: '运输任务不存在' });
    }

    const updated = TransportTaskModel.update(task.id, req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('更新运输任务失败:', err);
    res.status(500).json({ error: '更新失败', message: err.message });
  }
});

router.post('/:waybill_no/complete', (req, res) => {
  try {
    const { end_time } = req.body;
    const task = TransportTaskModel.completeTask(req.params.waybill_no, end_time);
    
    if (!task) {
      return res.status(404).json({ error: '运输任务不存在' });
    }

    res.json({ success: true, data: task });
  } catch (err) {
    console.error('完成运输任务失败:', err);
    res.status(500).json({ error: '操作失败', message: err.message });
  }
});

module.exports = router;
