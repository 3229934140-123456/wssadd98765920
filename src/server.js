const app = require('./app');
const config = require('./config');
const { getDb } = require('./db');

const db = getDb();

const server = app.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║   冷藏车厢温度追踪服务 Cold-Chain Temp Tracker           ║
╠══════════════════════════════════════════════════════════╣
║   服务端口: ${config.port}                                        ║
║   数据库: SQLite (${config.db.path})  ║
║                                                          ║
║   API 文档:                                              ║
║     GET  /health                 - 健康检查              ║
║                                                          ║
║   设备接入:                                              ║
║     POST /api/temperature/report  - 温度数据上报         ║
║     GET  /api/temperature/latest/:device_no              ║
║                                                          ║
║   温区规则:                                              ║
║     GET  /api/rules                - 规则列表            ║
║     POST /api/rules                - 创建规则            ║
║     PUT  /api/rules/:id            - 更新规则            ║
║                                                          ║
║   运单查询:                                              ║
║     GET  /api/query/summary/:waybill_no - 温度摘要       ║
║     GET  /api/query/records/:waybill_no - 历史记录       ║
║     GET  /api/query/alerts/:waybill_no  - 告警记录       ║
║                                                          ║
║   管理窗口:                                              ║
║     GET  /api/admin/stats          - 系统概览            ║
║     GET  /api/admin/query-logs     - 查询日志            ║
║     GET  /api/devices              - 设备管理            ║
╚══════════════════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务...');
  server.close(() => {
    db.close();
    console.log('服务已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n收到 SIGINT 信号，正在关闭服务...');
  server.close(() => {
    db.close();
    console.log('服务已关闭');
    process.exit(0);
  });
});

module.exports = server;
