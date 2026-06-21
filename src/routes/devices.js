const express = require('express');
const router = express.Router();
const DeviceModel = require('../models/device');

router.get('/', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const page_size = parseInt(req.query.page_size) || 20;
    const status = req.query.status;

    const result = DeviceModel.findAll({ page, page_size, status });
    
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('查询设备列表失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const device = DeviceModel.findById(parseInt(req.params.id));
    if (!device) {
      return res.status(404).json({ error: '设备不存在' });
    }
    res.json({ success: true, data: device });
  } catch (err) {
    console.error('查询设备失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

router.post('/', (req, res) => {
  try {
    const { device_no, plate_number, compartment_no, status, vendor } = req.body;

    if (!device_no || !plate_number || !compartment_no) {
      return res.status(400).json({ error: '设备编号、车牌和车厢编号不能为空' });
    }

    const existing = DeviceModel.findByDeviceNo(device_no);
    if (existing) {
      return res.status(400).json({ error: '设备编号已存在' });
    }

    const device = DeviceModel.create({
      device_no,
      plate_number,
      compartment_no,
      status,
      vendor
    });

    res.status(201).json({
      success: true,
      data: device
    });
  } catch (err) {
    console.error('创建设备失败:', err);
    res.status(500).json({ error: '创建失败', message: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const device = DeviceModel.findById(id);
    if (!device) {
      return res.status(404).json({ error: '设备不存在' });
    }

    const updated = DeviceModel.update(id, req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('更新设备失败:', err);
    res.status(500).json({ error: '更新失败', message: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = DeviceModel.delete(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: '设备不存在' });
    }
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('删除设备失败:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

module.exports = router;
