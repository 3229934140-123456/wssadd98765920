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

    const result = await TemperatureService.reportTemperature({
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
        alert: result.alert
      }
    });
  } catch (err) {
    console.error('温度上报失败:', err);
    res.status(500).json({ error: '温度上报失败', message: err.message });
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
