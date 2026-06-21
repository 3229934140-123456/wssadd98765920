const express = require('express');
const router = express.Router();
const TemperatureService = require('../services/temperatureService');
const DeviceModel = require('../models/device');

router.post('/report', async (req, res) => {
  try {
    const { device_no, plate_number, compartment_no, temperature, 
            humidity, location_lat, location_lng, location_text, record_time } = req.body;

    if (!device_no) {
      return res.status(400).json({ error: '设备编号 device_no 不能为空' });
    }
    if (!plate_number || !compartment_no) {
      return res.status(400).json({ error: '车牌和车厢编号不能为空' });
    }
    if (temperature === undefined || temperature === null) {
      return res.status(400).json({ error: '温度值不能为空' });
    }

    const device = DeviceModel.findByDeviceNo(device_no);
    if (!device) {
      return res.status(400).json({ error: '设备未注册，请先在管理平台接入设备' });
    }

    const result = TemperatureService.reportTemperature({
      device_no,
      plate_number,
      compartment_no,
      temperature: Number(temperature),
      humidity: humidity !== undefined ? Number(humidity) : undefined,
      location_lat: location_lat !== undefined ? Number(location_lat) : undefined,
      location_lng: location_lng !== undefined ? Number(location_lng) : undefined,
      location_text,
      record_time
    });

    res.json({
      success: true,
      data: {
        record_id: result.record.id,
        waybill_no: result.waybill_no,
        record_time: result.record.record_time,
        duplicated: result.duplicated,
        alert: result.alert
      }
    });
  } catch (err) {
    console.error('温度上报失败:', err);
    res.status(500).json({ error: '温度上报失败', message: err.message });
  }
});

router.post('/batch-report', async (req, res) => {
  try {
    const { records, device_no } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: '上报记录不能为空，且必须是数组格式' });
    }

    if (records.length > 1000) {
      return res.status(400).json({ error: '单次批量上报不能超过 1000 条记录' });
    }

    const firstDeviceNo = records[0].device_no || device_no;
    if (!firstDeviceNo) {
      return res.status(400).json({ error: '必须提供 device_no' });
    }

    const device = DeviceModel.findByDeviceNo(firstDeviceNo);
    if (!device) {
      return res.status(400).json({ error: '设备未注册，请先在管理平台接入设备' });
    }

    const normalizedRecords = records.map(r => ({
      ...r,
      device_no: r.device_no || firstDeviceNo,
      temperature: Number(r.temperature),
      humidity: r.humidity !== undefined ? Number(r.humidity) : undefined,
      location_lat: r.location_lat !== undefined ? Number(r.location_lat) : undefined,
      location_lng: r.location_lng !== undefined ? Number(r.location_lng) : undefined
    }));

    const result = TemperatureService.batchReportTemperature(normalizedRecords);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('批量温度上报失败:', err);
    res.status(500).json({ error: '批量上报失败', message: err.message });
  }
});

router.get('/latest/:device_no', (req, res) => {
  try {
    const { device_no } = req.params;
    const TemperatureRecordModel = require('../models/temperatureRecord');
    const record = TemperatureRecordModel.getLatestByDevice(device_no);
    
    res.json({
      success: true,
      data: record
    });
  } catch (err) {
    console.error('查询最新温度失败:', err);
    res.status(500).json({ error: '查询失败' });
  }
});

module.exports = router;
