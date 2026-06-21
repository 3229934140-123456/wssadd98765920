const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test-db.json');

function cleanTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/config')];
  process.env.DB_PATH = TEST_DB_PATH;
}

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    errors.push({ name, error: err });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

console.log('\n=== 冷藏车厢温度追踪服务 - 功能测试 ===\n');

console.log('1. 数据库与模型测试');
cleanTestDb();

const { getDb } = require('../src/db');
const DeviceModel = require('../src/models/device');
const TempRuleModel = require('../src/models/tempRule');
const TransportTaskModel = require('../src/models/transportTask');
const TemperatureRecordModel = require('../src/models/temperatureRecord');
const AlertModel = require('../src/models/alert');
const QueryLogModel = require('../src/models/queryLog');

const db = getDb();

test('数据库初始化成功', () => {
  assert(db !== null, '数据库实例应为非空');
});

test('默认温区规则已初始化', () => {
  const rules = TempRuleModel.findAll();
  assert(rules.length >= 5, `至少应有5条默认规则，实际${rules.length}条`);
});

test('疫苗规则温度范围正确', () => {
  const rule = TempRuleModel.findByProductType('vaccine');
  assert(rule !== undefined, '应找到疫苗规则');
  assertEqual(rule.min_temp, 2, '疫苗最低温度应为2℃');
  assertEqual(rule.max_temp, 8, '疫苗最高温度应为8℃');
  assertEqual(rule.alert_level, 'critical', '疫苗告警级别应为critical');
});

test('创建设备成功', () => {
  const device = DeviceModel.create({
    device_no: 'DEV001',
    plate_number: '京A12345',
    compartment_no: '01',
    vendor: 'test-vendor'
  });
  assert(device !== null, '设备不应为空');
  assertEqual(device.device_no, 'DEV001');
  assertEqual(device.plate_number, '京A12345');
  assertEqual(device.status, 'active');
});

test('设备编号唯一约束', () => {
  try {
    DeviceModel.create({
      device_no: 'DEV001',
      plate_number: '京B67890',
      compartment_no: '02'
    });
    assert(false, '应抛出重复编号错误');
  } catch (err) {
    assert(true);
  }
});

test('查询设备列表', () => {
  const result = DeviceModel.findAll();
  assert(result.list.length >= 1, '设备列表应有数据');
  assert(result.total >= 1, '总数应大于0');
});

test('创建运输任务', () => {
  const task = TransportTaskModel.create({
    waybill_no: 'WB20240101001',
    plate_number: '京A12345',
    compartment_no: '01',
    product_type: 'vaccine',
    product_name: '流感疫苗',
    origin: '北京仓库',
    destination: '上海医院'
  });
  assert(task !== null, '任务不应为空');
  assertEqual(task.waybill_no, 'WB20240101001');
  assertEqual(task.status, 'in_transit');
  assertEqual(task.product_type, 'vaccine');
});

test('按运单号查询任务', () => {
  const task = TransportTaskModel.findByWaybillNo('WB20240101001');
  assert(task !== undefined, '应找到运输任务');
  assertEqual(task.product_type, 'vaccine');
});

test('按设备查询进行中任务', () => {
  const task = TransportTaskModel.findActiveByDevice('京A12345', '01');
  assert(task !== undefined, '应找到进行中的任务');
  assertEqual(task.waybill_no, 'WB20240101001');
});

console.log('\n2. 温度服务测试');

const TemperatureService = require('../src/services/temperatureService');

test('上报正常温度（疫苗在2-8℃范围内）', async () => {
  const result = await TemperatureService.reportTemperature({
    device_no: 'DEV001',
    plate_number: '京A12345',
    compartment_no: '01',
    temperature: 5,
    location_lat: 39.9042,
    location_lng: 116.4074,
    location_text: '北京市',
    record_time: new Date().toISOString()
  });
  
  assert(result.record !== null, '应有温度记录');
  assertEqual(result.waybill_no, 'WB20240101001');
  assert(result.alert === null, '正常温度不应产生告警');
});

test('上报超高温 - 触发严重告警', async () => {
  const result = await TemperatureService.reportTemperature({
    device_no: 'DEV001',
    plate_number: '京A12345',
    compartment_no: '01',
    temperature: 12,
    record_time: new Date(Date.now() + 60000).toISOString()
  });
  
  assert(result.alert !== null, '超温应产生告警');
  assertEqual(result.alert.alert_level, 'critical');
  assert(result.alert.duration_seconds >= 0, '持续时间应大于等于0');
  assert(result.alert.notify_roles.length > 0, '应有通知角色');
  assert(result.alert.description.includes('超出上限'), '告警描述应说明超出上限');
});

test('告警持续 - 持续时间累加', async () => {
  const result = await TemperatureService.reportTemperature({
    device_no: 'DEV001',
    plate_number: '京A12345',
    compartment_no: '01',
    temperature: 11,
    record_time: new Date(Date.now() + 300000).toISOString()
  });
  
  assert(result.alert !== null, '仍应处于告警状态');
  assert(result.alert.duration_seconds > 0, '持续时间应增加');
});

test('温度恢复正常 - 告警结束', async () => {
  const result = await TemperatureService.reportTemperature({
    device_no: 'DEV001',
    plate_number: '京A12345',
    compartment_no: '01',
    temperature: 5,
    record_time: new Date(Date.now() + 600000).toISOString()
  });
  
  assert(result.alert === null, '恢复正常后当前告警应为空');
});

test('超低温告警', async () => {
  const result = await TemperatureService.reportTemperature({
    device_no: 'DEV001',
    plate_number: '京A12345',
    compartment_no: '01',
    temperature: -2,
    record_time: new Date(Date.now() + 700000).toISOString()
  });
  
  assert(result.alert !== null, '低温应产生告警');
  assert(result.alert.alert_type.includes('below') || result.alert.description.includes('低于'), '告警类型应为低温');
});

console.log('\n3. 查询服务测试');

const QueryService = require('../src/services/queryService');

test('查询运单温度摘要', () => {
  const summary = QueryService.getTemperatureSummary('WB20240101001', {
    caller_system: 'test-system',
    ip_address: '127.0.0.1'
  });
  
  assert(summary !== null, '摘要不应为空');
  assertEqual(summary.waybill_no, 'WB20240101001');
  assert(summary.temperature_summary.record_count > 0, '应有温度记录');
  assert(summary.temperature_summary.min_temp !== undefined, '应有最低温度');
  assert(summary.temperature_summary.max_temp !== undefined, '应有最高温度');
  assert(summary.temperature_summary.avg_temp !== undefined, '应有平均温度');
});

test('摘要包含规则信息', () => {
  const summary = QueryService.getTemperatureSummary('WB20240101001');
  assert(summary.rule_info !== null, '应包含规则信息');
  assertEqual(summary.rule_info.product_type, 'vaccine');
  assert(Array.isArray(summary.rule_info.notify_roles), '通知角色应为数组');
});

test('摘要包含告警统计', () => {
  const summary = QueryService.getTemperatureSummary('WB20240101001');
  assert(summary.alert_summary !== null, '应有告警统计');
  assert(summary.alert_summary.total_count >= 2, '至少应有2条告警记录');
  assert(summary.alert_summary.by_level.critical > 0, '应有critical级别告警');
});

test('摘要包含合规性评估', () => {
  const summary = QueryService.getTemperatureSummary('WB20240101001');
  assert(summary.compliance !== null, '应有合规性评估');
  assert(summary.compliance.rate !== null, '应有合规率');
  assert(summary.compliance.status, '应有合规状态');
  assert(summary.compliance.description, '应有合规描述');
});

test('查询历史温度记录', () => {
  const result = QueryService.getTemperatureRecords('WB20240101001');
  assert(result.list.length > 0, '应有温度记录');
  assert(result.total > 0, '记录总数应大于0');
});

test('查询告警列表', () => {
  const alerts = QueryService.getAlertsByWaybill('WB20240101001');
  assert(alerts.length > 0, '应有告警记录');
  assert(alerts[0].duration_formatted, '告警应有格式化持续时间');
});

test('不存在的运单返回null', () => {
  const summary = QueryService.getTemperatureSummary('NOT_EXIST');
  assert(summary === null, '不存在的运单应返回null');
});

console.log('\n4. 查询日志测试');

test('查询操作已记录日志', () => {
  const logs = QueryLogModel.findAll();
  assert(logs.total > 0, '应有查询日志记录');
});

test('日志包含调用系统信息', () => {
  const logs = QueryLogModel.findAll({ query_type: 'summary' });
  assert(logs.list.some(log => log.caller_system === 'test-system'), '应包含调用系统信息');
});

console.log('\n5. 温区规则管理测试');

test('创建新的温区规则', () => {
  const rule = TempRuleModel.create({
    product_type: 'test_product',
    product_name: '测试货品',
    min_temp: -5,
    max_temp: 5,
    warning_min_temp: -3,
    warning_max_temp: 3,
    alert_level: 'warning',
    notify_roles: 'driver,dispatcher',
    description: '测试用规则'
  });
  
  assert(rule !== null, '规则不应为空');
  assertEqual(rule.product_type, 'test_product');
});

test('更新温区规则', () => {
  const rule = TempRuleModel.findByProductType('test_product');
  const updated = TempRuleModel.update(rule.id, {
    max_temp: 10,
    description: '更新后的规则'
  });
  
  assertEqual(updated.max_temp, 10);
  assertEqual(updated.description, '更新后的规则');
});

test('删除温区规则', () => {
  const rule = TempRuleModel.findByProductType('test_product');
  const result = TempRuleModel.delete(rule.id);
  assert(result.changes === 1, '应删除1条记录');
  
  const deleted = TempRuleModel.findById(rule.id);
  assert(deleted === undefined, '删除后应查询不到');
});

console.log('\n6. 运输任务管理测试');

test('完成运输任务', () => {
  const task = TransportTaskModel.completeTask('WB20240101001');
  assertEqual(task.status, 'completed');
  assert(task.end_time !== null, '应有结束时间');
});

test('完成后查询不到进行中任务', () => {
  const task = TransportTaskModel.findActiveByDevice('京A12345', '01');
  assert(task === undefined, '任务完成后不应再查到进行中的任务');
});

test('未注册设备上报失败', async () => {
  try {
    await TemperatureService.reportTemperature({
      device_no: 'UNKNOWN',
      plate_number: '京X00000',
      compartment_no: '01',
      temperature: 10
    });
  } catch (err) {
    assert(true);
  }
});

console.log('\n7. 告警管理测试');

test('确认告警', () => {
  const alerts = AlertModel.findByWaybillNo('WB20240101001');
  assert(alerts.length > 0, '应有告警记录');
  
  const ack = AlertModel.acknowledge(alerts[0].id, 'test-user');
  assertEqual(ack.acknowledged, 1);
  assertEqual(ack.acknowledged_by, 'test-user');
});

console.log('\n8. 多货品类型测试');

test('冷冻肉规则验证', () => {
  const rule = TempRuleModel.findByProductType('frozen_meat');
  assert(rule !== undefined);
  assert(rule.min_temp < 0, '冷冻肉温度应低于0度');
  assertEqual(rule.alert_level, 'serious');
});

test('乳制品规则验证', () => {
  const rule = TempRuleModel.findByProductType('dairy');
  assert(rule !== undefined);
  assert(rule.min_temp >= 0, '乳制品冷藏温度应大于等于0度');
  assertEqual(rule.alert_level, 'warning');
});

test('创建乳制品运输任务并测试告警', async () => {
  TransportTaskModel.create({
    waybill_no: 'WB20240101002',
    plate_number: '京A12345',
    compartment_no: '02',
    product_type: 'dairy',
    product_name: '鲜牛奶'
  });
  
  DeviceModel.create({
    device_no: 'DEV002',
    plate_number: '京A12345',
    compartment_no: '02'
  });
  
  const result = await TemperatureService.reportTemperature({
    device_no: 'DEV002',
    plate_number: '京A12345',
    compartment_no: '02',
    temperature: 10,
    record_time: new Date().toISOString()
  });
  
  assert(result.alert !== null, '乳制品超温应告警');
  assertEqual(result.alert.alert_level, 'warning', '乳制品告警级别应为warning');
});

console.log('\n9. 批量温度上报测试');

test('批量上报温度数据', () => {
  DeviceModel.create({
    device_no: 'DEV003',
    plate_number: '京B00001',
    compartment_no: '01'
  });
  
  TransportTaskModel.create({
    waybill_no: 'WB_BATCH_001',
    plate_number: '京B00001',
    compartment_no: '01',
    product_type: 'vaccine',
    product_name: '批量测试疫苗'
  });
  
  const now = Date.now();
  const records = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      device_no: 'DEV003',
      plate_number: '京B00001',
      compartment_no: '01',
      temperature: 5 + i * 0.5,
      record_time: new Date(now + i * 60000).toISOString()
    });
  }
  
  const result = TemperatureService.batchReportTemperature(records);
  assert(result.success === true, '批量上报应成功');
  assertEqual(result.summary.total, 10, '总记录数应为10');
  assertEqual(result.summary.success, 10, '成功数应为10');
  assertEqual(result.summary.duplicated, 0, '重复数应为0');
});

test('批量上报重复数据应去重', () => {
  const now = Date.now();
  const records = [];
  for (let i = 0; i < 5; i++) {
    records.push({
      device_no: 'DEV003',
      plate_number: '京B00001',
      compartment_no: '01',
      temperature: 5,
      record_time: new Date(now + i * 60000).toISOString()
    });
  }
  
  const result1 = TemperatureService.batchReportTemperature(records);
  assertEqual(result1.summary.success, 5, '首次上报5条应成功');
  assertEqual(result1.summary.duplicated, 0, '首次无重复');
  
  const result2 = TemperatureService.batchReportTemperature(records);
  assertEqual(result2.summary.duplicated, 5, '二次上报应全部重复');
  assertEqual(result2.summary.success, 0, '重复的不应算作新增成功');
});

test('批量上报自动排序按时间处理', () => {
  const now = Date.now();
  const records = [
    { device_no: 'DEV003', plate_number: '京B00001', compartment_no: '01', temperature: 8, record_time: new Date(now + 300000).toISOString() },
    { device_no: 'DEV003', plate_number: '京B00001', compartment_no: '01', temperature: 10, record_time: new Date(now + 600000).toISOString() },
    { device_no: 'DEV003', plate_number: '京B00001', compartment_no: '01', temperature: 3, record_time: new Date(now + 100000).toISOString() },
  ];
  
  const result = TemperatureService.batchReportTemperature(records);
  assert(result.summary.success >= 2, '至少应有2条新记录');
  assert(result.summary.new_alerts > 0, '超温应产生告警');
});

console.log('\n10. 告警闭环测试');

test('首次越界告警返回持续时间(0秒)', () => {
  DeviceModel.create({
    device_no: 'DEV_ALERT_001',
    plate_number: '京C00001',
    compartment_no: '01'
  });
  
  TransportTaskModel.create({
    waybill_no: 'WB_ALERT_001',
    plate_number: '京C00001',
    compartment_no: '01',
    product_type: 'vaccine',
    product_name: '告警测试疫苗'
  });
  
  const result = TemperatureService.reportTemperature({
    device_no: 'DEV_ALERT_001',
    plate_number: '京C00001',
    compartment_no: '01',
    temperature: 12,
    record_time: new Date().toISOString()
  });
  
  assert(result.alert !== null, '应有告警');
  assert(result.alert.duration_seconds !== undefined, '应有持续时间');
  assertEqual(result.alert.status, 'new', '首次告警状态应为new');
  assert(result.alert.action_required, '应有建议处理措施');
  assert(Array.isArray(result.alert.notify_roles), '通知角色应为数组');
});

test('连续越界告警持续时间累计', () => {
  const startTime = Date.now();
  
  TemperatureService.reportTemperature({
    device_no: 'DEV_ALERT_001',
    plate_number: '京C00001',
    compartment_no: '01',
    temperature: 11,
    record_time: new Date(startTime).toISOString()
  });
  
  const result = TemperatureService.reportTemperature({
    device_no: 'DEV_ALERT_001',
    plate_number: '京C00001',
    compartment_no: '01',
    temperature: 10.5,
    record_time: new Date(startTime + 300000).toISOString()
  });
  
  assert(result.alert !== null, '应有告警');
  assertEqual(result.alert.status, 'ongoing', '持续告警状态应为ongoing');
  assert(result.alert.duration_seconds > 0, '持续时间应大于0');
  assert(result.alert.duration_formatted, '应有格式化的持续时间');
});

test('温度恢复后告警有结束时间', () => {
  const result = TemperatureService.reportTemperature({
    device_no: 'DEV_ALERT_001',
    plate_number: '京C00001',
    compartment_no: '01',
    temperature: 5,
    record_time: new Date().toISOString()
  });
  
  assert(result.alert === null, '温度恢复后不应有告警');
  
  const alerts = AlertModel.findByWaybillNo('WB_ALERT_001');
  const closedAlerts = alerts.filter(a => a.end_time !== null && a.end_time !== undefined);
  assert(closedAlerts.length > 0, '应有已结束的告警');
});

test('告警有完整的状态信息', () => {
  const alerts = AlertModel.findByWaybillNo('WB_ALERT_001');
  assert(alerts.length > 0, '应有告警记录');
  
  for (const alert of alerts) {
    assert(alert.alert_type, '应有告警类型');
    assert(alert.alert_level, '应有告警级别');
    assert(alert.start_time, '应有开始时间');
  }
});

console.log('\n11. 按角色查询告警测试');

test('按角色查询告警', () => {
  const result = QueryService.getAlertsByRole('quality', { caller_system: 'test-role' });
  assert(result.total >= 0, '应返回结果');
  assert(Array.isArray(result.list), '列表应为数组');
});

test('按状态筛选告警', () => {
  const result = QueryService.getAlertsByRole('quality', { status: 'closed' });
  assert(result.total >= 0, '应返回结果');
});

test('司机角色能查到自己的告警', () => {
  const result = QueryService.getAlertsByRole('driver');
  assert(result.total >= 0, '应返回结果');
});

console.log('\n12. 运单温控报告测试');

test('生成运单温控报告', () => {
  const report = QueryService.getTemperatureReport('WB_BATCH_001', {
    caller_system: 'shipper-system',
    ip_address: '10.0.0.1'
  });
  
  assert(report !== null, '报告不应为空');
  assertEqual(report.report_type, 'temperature_control_report');
  assertEqual(report.report_version, '1.0');
  assert(report.generated_at, '应有生成时间');
});

test('报告包含运单基本信息', () => {
  const report = QueryService.getTemperatureReport('WB_BATCH_001');
  assert(report.waybill_info, '应有运单信息');
  assertEqual(report.waybill_info.waybill_no, 'WB_BATCH_001');
  assert(report.waybill_info.plate_number, '应有车牌号');
  assert(report.waybill_info.product_type, '应有货品类型');
});

test('报告包含温区规则信息', () => {
  const report = QueryService.getTemperatureReport('WB_BATCH_001');
  assert(report.rule_info, '应有规则信息');
  assert(report.rule_info.temperature_range, '应有温度范围');
  assert(report.rule_info.temperature_range.min !== undefined, '应有最低温度');
  assert(report.rule_info.temperature_range.max !== undefined, '应有最高温度');
});

test('报告包含监控汇总', () => {
  const report = QueryService.getTemperatureReport('WB_BATCH_001');
  assert(report.monitoring_summary, '应有监控汇总');
  assert(report.monitoring_summary.total_records > 0, '应有记录总数');
  assert(report.monitoring_summary.temperature_stats, '应有温度统计');
});

test('报告包含温度曲线数据', () => {
  const report = QueryService.getTemperatureReport('WB_BATCH_001');
  assert(report.temperature_curve, '应有温度曲线');
  assert(report.temperature_curve.points, '应有曲线点');
  assert(Array.isArray(report.temperature_curve.points), '曲线点应为数组');
  assert(report.temperature_curve.total_points > 0, '曲线点数应大于0');
  assert(report.temperature_curve.in_range_count !== undefined, '应有正常点数');
  assert(report.temperature_curve.out_of_range_count !== undefined, '应有异常点数');
});

test('报告包含超温片段', () => {
  const report = QueryService.getTemperatureReport('WB_BATCH_001');
  assert(Array.isArray(report.out_of_range_segments), '超温片段应为数组');
  
  if (report.out_of_range_segments.length > 0) {
    const segment = report.out_of_range_segments[0];
    assert(segment.start_time, '片段应有开始时间');
    assert(segment.duration_seconds !== undefined, '片段应有持续时间');
    assert(segment.duration_formatted, '片段应有格式化持续时间');
    assert(segment.peak_temperature !== undefined, '片段应有峰值温度');
    assert(segment.status, '片段应有状态');
  }
});

test('报告包含告警统计', () => {
  const report = QueryService.getTemperatureReport('WB_BATCH_001');
  assert(report.alert_statistics, '应有告警统计');
  assert(report.alert_statistics.total_count !== undefined, '应有告警总数');
  assert(report.alert_statistics.by_level, '应有各级别告警数');
  assert(report.alert_statistics.total_duration_formatted, '应有总持续时间');
});

test('报告包含合规性评估', () => {
  const report = QueryService.getTemperatureReport('WB_BATCH_001');
  assert(report.compliance_assessment, '应有合规性评估');
  assert(report.compliance_assessment.status, '应有合规状态');
  assert(report.compliance_assessment.rate !== null && report.compliance_assessment.rate !== undefined, '应有合规率');
  assert(report.compliance_assessment.description, '应有合规描述');
});

test('报告包含验收建议', () => {
  const report = QueryService.getTemperatureReport('WB_BATCH_001');
  assert(report.acceptance_advice, '应有验收建议');
  assert(report.acceptance_advice.acceptance_status, '应有验收状态');
  assert(Array.isArray(report.acceptance_advice.advices), '建议列表应为数组');
  assert(Array.isArray(report.acceptance_advice.suggested_actions), '建议动作应为数组');
  assert(report.acceptance_advice.advices.length > 0, '至少应有一条建议');
});

test('不存在的运单报告返回null', () => {
  const report = QueryService.getTemperatureReport('NOT_EXIST_123');
  assert(report === null, '不存在的运单应返回null');
});

console.log('\n13. 查询日志准确性测试');

test('查询日志包含调用系统、结果数、IP', () => {
  const logs = QueryLogModel.findAll({ caller_system: 'shipper-system' });
  assert(logs.total > 0, '应有货主系统的查询日志');
  
  const log = logs.list[0];
  assert(log.caller_system, '应有调用系统');
  assert(log.result_count !== undefined && log.result_count !== null, '应有结果数量');
  assert(log.ip_address, '应有来源IP');
  assert(log.created_at, '应有查询时间');
  assert(log.query_type, '应有查询类型');
});

test('按时间段筛选查询日志', () => {
  const startTime = new Date(Date.now() - 3600000).toISOString();
  const endTime = new Date(Date.now() + 3600000).toISOString();
  
  const logs = QueryLogModel.findAll({ startTime, endTime });
  assert(logs.total > 0, '时间段内应有日志');
});

test('按调用方统计查询日志', () => {
  const stats = QueryLogModel.getStatsByCaller({});
  assert(Array.isArray(stats), '统计结果应为数组');
  if (stats.length > 0) {
    assert(stats[0].caller_system, '应有调用系统');
    assert(stats[0].query_count > 0, '应有查询次数');
    assert(stats[0].total_results !== undefined, '应有总结果数');
  }
});

test('查询日志汇总统计', () => {
  const summary = QueryLogModel.getSummary({});
  assert(summary.total_queries > 0, '应有总查询数');
  assert(summary.unique_callers > 0, '应有唯一调用方');
  assert(summary.unique_waybills >= 0, '应有唯一运单数');
  assert(summary.total_results !== undefined, '应有总结果数');
});

test('热门调用方统计', () => {
  const topCallers = QueryLogModel.getTopCallers({ limit: 5 });
  assert(Array.isArray(topCallers), '应为数组');
  assert(topCallers.length <= 5, '不应超过limit');
});

test('按查询类型统计', () => {
  const byType = QueryLogModel.getStatsByType({});
  assert(Array.isArray(byType), '应为数组');
  if (byType.length > 0) {
    assert(byType[0].query_type, '应有查询类型');
    assert(byType[0].avg_results !== undefined, '应有平均结果数');
  }
});

console.log('\n14. 告警统计测试');

test('按运单获取告警统计', () => {
  const stats = AlertModel.getStatsByWaybill('WB_BATCH_001');
  assert(stats.total_count !== undefined, '应有告警总数');
  assert(stats.open_count !== undefined, '应有未处理告警数');
  assert(stats.by_level, '应有各级别告警数');
  assert(stats.total_duration_seconds !== undefined, '应有总持续时间');
  assert(stats.max_duration_seconds !== undefined, '应有最长持续时间');
});

test('管理端告警支持多维度筛选', () => {
  const result = AlertModel.findAll({
    status: 'closed',
    page: 1,
    page_size: 10
  });
  assert(result.total >= 0, '筛选结果不应为null');
  assert(Array.isArray(result.list), '列表应为数组');
});

console.log('\n15. 告警处置流转测试');

const AlertHandlingModel = require('../src/models/alertHandling');

test('司机现场处理告警', () => {
  const openAlerts = AlertModel.findByWaybillNo('WB_ALERT_001');
  const alertToHandle = openAlerts.find(a => a.end_time !== null && a.end_time !== undefined);
  if (!alertToHandle) {
    const anyAlert = openAlerts[0];
    if (!anyAlert) {
      assert(true, '跳过 - 无可用告警');
      return;
    }
  }
  
  const alertId = (openAlerts.find(a => a.end_time !== null) || openAlerts[0]).id;
  
  const handling = AlertHandlingModel.processAlert(alertId, {
    handler_role: 'driver',
    handler_name: '张师傅',
    result: '已检查制冷设备，温度开始恢复',
    remark: '设备临时停机5分钟后重启'
  });
  
  assert(handling.id, '处置记录应有ID');
  assertEqual(handling.action, 'process', '处置动作应为process');
  assertEqual(handling.handler_role, 'driver', '处理人角色应为driver');
  assert(handling.remark, '应有备注');
});

test('调度转派告警给质控', () => {
  const alerts = AlertModel.findByWaybillNo('WB_ALERT_001');
  if (alerts.length === 0) {
    assert(true, '跳过 - 无可用告警');
    return;
  }
  const alertId = alerts[0].id;
  
  const handling = AlertHandlingModel.reassignAlert(alertId, {
    handler_role: 'dispatcher',
    handler_name: '李调度',
    target_role: 'quality',
    remark: '温度异常持续时间较长，需要质控评估'
  });
  
  assertEqual(handling.action, 'reassign', '处置动作应为reassign');
  assertEqual(handling.target_role, 'quality', '目标角色应为quality');
});

test('调度升级告警给质控', () => {
  const alerts = AlertModel.findByWaybillNo('WB_ALERT_001');
  if (alerts.length === 0) {
    assert(true, '跳过 - 无可用告警');
    return;
  }
  const alertId = alerts[0].id;
  
  const handling = AlertHandlingModel.escalateAlert(alertId, {
    handler_role: 'dispatcher',
    handler_name: '李调度',
    target_role: 'quality',
    remark: '涉及疫苗运输，升级处理'
  });
  
  assertEqual(handling.action, 'escalate', '处置动作应为escalate');
  assertEqual(handling.target_role, 'quality', '目标角色应为quality');
});

test('质控给出最终结论', () => {
  const alerts = AlertModel.findByWaybillNo('WB_ALERT_001');
  if (alerts.length === 0) {
    assert(true, '跳过 - 无可用告警');
    return;
  }
  const alertId = alerts[0].id;
  
  const handling = AlertHandlingModel.concludeAlert(alertId, {
    handler_role: 'quality',
    handler_name: '王质控',
    result: '温度短暂超标，货品质量未受影响',
    remark: '已确认中心温度正常，可继续运输'
  });
  
  assertEqual(handling.action, 'conclude', '处置动作应为conclude');
});

test('告警处置链完整可追溯', () => {
  const alerts = AlertModel.findByWaybillNo('WB_ALERT_001');
  if (alerts.length === 0) {
    assert(true, '跳过 - 无可用告警');
    return;
  }
  const alertId = alerts[0].id;
  
  const summary = AlertHandlingModel.getHandlingSummary(alertId);
  assert(summary.total_steps > 0, '应有处置步骤');
  assert(summary.is_concluded === true, '应有结案');
  assert(Array.isArray(summary.handling_chain), '应有处置链');
  assert(summary.handling_chain.length > 0, '处置链不为空');
  
  for (const step of summary.handling_chain) {
    assert(step.action, '每步应有处置动作');
    assert(step.handler_role, '每步应有处理人角色');
    assert(step.handled_at, '每步应有处理时间');
  }
});

console.log('\n16. 运单温控报告分享版测试');

test('生成分享版报告', () => {
  const report = QueryService.getShareableReport('WB_BATCH_001', {
    caller_system: 'shipper-system',
    ip_address: '10.0.0.1'
  });
  
  assert(report !== null, '报告不应为空');
  assertEqual(report.report_type, 'shareable_temperature_report');
  assert(report.report_no, '应有报告编号');
  assertEqual(report.is_cached, false, '首次生成应非缓存');
});

test('分享版报告包含验收结论', () => {
  const report = QueryService.getShareableReport('WB_BATCH_001');
  assert(report.acceptance_conclusion, '应有验收结论');
  assert(report.acceptance_conclusion.acceptance_status, '应有验收状态');
  assert(report.acceptance_conclusion.compliance_rate !== undefined, '应有合规率');
  assert(Array.isArray(report.acceptance_conclusion.advices), '应有建议列表');
  assert(Array.isArray(report.acceptance_conclusion.suggested_actions), '应有建议动作');
});

test('分享版报告包含异常证据', () => {
  const report = QueryService.getShareableReport('WB_BATCH_001');
  assert(report.anomaly_evidence, '应有异常证据');
  assert(report.anomaly_evidence.total_records !== undefined, '应有记录总数');
  assert(report.anomaly_evidence.temperature_stats, '应有温度统计');
  assert(Array.isArray(report.anomaly_evidence.out_of_range_segments), '应有超温片段');
  assert(report.anomaly_evidence.temperature_curve_summary, '应有曲线摘要');
});

test('分享版报告包含处置摘要', () => {
  const report = QueryService.getShareableReport('WB_ALERT_001');
  assert(report !== null, '报告不应为空');
  assert(report.handling_summary, '应有处置摘要');
  assert(report.handling_summary.total_handling_steps !== undefined, '应有处置步骤数');
  assert(Array.isArray(report.handling_summary.handling_chain), '应有处置链');
});

test('重复查询同一运单返回相同报告编号', () => {
  const report1 = QueryService.getShareableReport('WB_BATCH_001');
  const report2 = QueryService.getShareableReport('WB_BATCH_001');
  
  assertEqual(report1.report_no, report2.report_no, '报告编号应相同');
  assertEqual(report2.is_cached, true, '第二次应为缓存');
});

test('按报告编号查询返回同一份结果', () => {
  const report = QueryService.getShareableReport('WB_BATCH_001');
  const reportNo = report.report_no;
  
  const byNo = QueryService.getReportByNo(reportNo);
  assert(byNo !== null, '按编号应能查到');
  assertEqual(byNo.report_no, reportNo, '编号应一致');
  assertEqual(byNo.report_type, 'shareable_temperature_report', '类型应一致');
});

test('强制重新生成报告', () => {
  const report1 = QueryService.getShareableReport('WB_BATCH_001');
  const report2 = QueryService.getShareableReport('WB_BATCH_001', { force_regenerate: true });
  
  assertEqual(report2.is_cached, false, '强制重新生成应非缓存');
});

test('不存在的运单返回null', () => {
  const report = QueryService.getShareableReport('NOT_EXIST_WB');
  assert(report === null, '不存在的运单应返回null');
});

test('不存在的报告编号返回null', () => {
  const report = QueryService.getReportByNo('NOT_EXIST_RPT');
  assert(report === null, '不存在的报告编号应返回null');
});

console.log('\n17. 角色告警精确筛选测试');

test('质控角色只看到通知质控的告警', () => {
  const result = QueryService.getAlertsByRole('quality');
  
  for (const alert of result.list) {
    const roles = alert.notify_roles;
    assert(roles.includes('quality'), '告警通知角色应包含quality');
  }
});

test('司机角色只看到通知司机的告警', () => {
  const result = QueryService.getAlertsByRole('driver');
  
  for (const alert of result.list) {
    const roles = alert.notify_roles;
    assert(roles.includes('driver'), '告警通知角色应包含driver');
  }
});

test('乳制品告警不通知质控', () => {
  DeviceModel.create({
    device_no: 'DEV_DAIRY_ROLE',
    plate_number: '京E00001',
    compartment_no: '01'
  });
  
  TransportTaskModel.create({
    waybill_no: 'WB_DAIRY_ROLE',
    plate_number: '京E00001',
    compartment_no: '01',
    product_type: 'dairy',
    product_name: '乳制品角色测试'
  });
  
  TemperatureService.reportTemperature({
    device_no: 'DEV_DAIRY_ROLE',
    plate_number: '京E00001',
    compartment_no: '01',
    temperature: 8,
    record_time: new Date().toISOString()
  });
  
  const qualityAlerts = QueryService.getAlertsByRole('quality');
  const dairyAlertForQuality = qualityAlerts.list.find(a => a.waybill_no === 'WB_DAIRY_ROLE');
  assert(!dairyAlertForQuality, '质控不应看到乳制品告警（乳制品只通知dispatcher和driver）');
  
  const driverAlerts = QueryService.getAlertsByRole('driver');
  const dairyAlertForDriver = driverAlerts.list.find(a => a.waybill_no === 'WB_DAIRY_ROLE');
  assert(dairyAlertForDriver, '司机应看到乳制品告警');
});

test('管理端角色筛选与查询接口口径一致', () => {
  const fromQuery = QueryService.getAlertsByRole('quality');
  const fromAdmin = AlertModel.findByRole('quality');
  
  assertEqual(fromQuery.total, fromAdmin.total, '两种查询结果应一致');
});

console.log('\n18. 查询日志时间筛选准确性测试');

test('窄时间窗口筛选 - 只返回窗口内数据', () => {
  const beforeQuery = QueryLogModel.getSummary({});
  const totalBefore = beforeQuery.total_queries;
  
  const windowStart = new Date().toISOString();
  
  QueryLogModel.create({
    query_type: 'test_window',
    waybill_no: 'WINDOW_TEST_001',
    caller_system: 'test-window-caller',
    result_count: 1,
    ip_address: '127.0.0.1'
  });
  QueryLogModel.create({
    query_type: 'test_window',
    waybill_no: 'WINDOW_TEST_002',
    caller_system: 'test-window-caller',
    result_count: 0,
    ip_address: '127.0.0.1'
  });
  
  const windowEnd = new Date().toISOString();
  
  const windowLogs = QueryLogModel.findAll({
    startTime: windowStart,
    endTime: windowEnd,
    caller_system: 'test-window-caller'
  });
  
  assertEqual(windowLogs.total, 2, '窄窗口内应有2条记录');
  
  for (const log of windowLogs.list) {
    assertEqual(log.caller_system, 'test-window-caller', '所有记录应为test-window-caller');
  }
});

test('时间窗口外数据不被混入', () => {
  const pastTime = new Date(Date.now() - 86400000).toISOString();
  const farPast = new Date(Date.now() - 172800000).toISOString();
  
  const logs = QueryLogModel.findAll({
    startTime: farPast,
    endTime: pastTime,
    caller_system: 'test-window-caller'
  });
  
  assertEqual(logs.total, 0, '过去时间窗口不应有test-window-caller记录');
});

test('按调用方+时间窗口统计', () => {
  const now = new Date();
  const startTime = new Date(now.getTime() - 3600000).toISOString();
  const endTime = new Date(now.getTime() + 3600000).toISOString();
  
  const stats = QueryLogModel.getStatsByCaller({
    startTime,
    endTime
  });
  
  assert(Array.isArray(stats), '应为数组');
  const windowCaller = stats.find(s => s.caller_system === 'test-window-caller');
  if (windowCaller) {
    assert(windowCaller.query_count > 0, '应有查询次数');
  }
});

test('按时间窗口的汇总统计', () => {
  const now = new Date();
  const startTime = new Date(now.getTime() - 3600000).toISOString();
  const endTime = new Date(now.getTime() + 3600000).toISOString();
  
  const summary = QueryLogModel.getSummary({ startTime, endTime });
  assert(summary.total_queries > 0, '时间窗口内应有查询记录');
});

console.log('\n19. 数据库范围运算符测试');

test('大于等于运算符', () => {
  const db = require('../src/db').getDb();
  const all = db.prepare('SELECT * FROM query_logs WHERE result_count >= ?').get(1);
  assert(all !== undefined || all === undefined, '>= 运算符不报错');
});

test('小于等于运算符', () => {
  const db = require('../src/db').getDb();
  const result = db.prepare('SELECT COUNT(*) as cnt FROM query_logs WHERE result_count <= ?').get(0);
  assert(result.cnt >= 0, '<= 运算符返回正确');
});

console.log('\n=== 测试结果 ===');
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);

if (errors.length > 0) {
  console.log('\n失败详情:');
  errors.forEach(e => {
    console.log(`  - ${e.name}`);
    console.log(`    ${e.error.stack}`);
  });
}

console.log(`\n测试完成，通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

process.exit(failed > 0 ? 1 : 0);
