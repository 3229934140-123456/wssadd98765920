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
