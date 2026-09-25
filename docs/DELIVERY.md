# Voice Studio 交付清单

## 当前可交付范围

本版本面向单机或受控内网运行，覆盖声音角色的四种来源：AI 原创设计、授权真人克隆、Provider 预置音色和导入已有 Voice Profile。

- 元数据存于 SQLite，迁移由 `server/db/migrations.ts` 管理。
- 音频、授权 PDF、导入包、设计批次、验证输出与冻结 Profile 存于 `SEMOVIX_LIBRARY_DIR`。
- 每个可发布来源都保存来源快照、SHA-256、验证报告、人工完整回听确认和不可覆盖的 `manifest.json`。
- AI 原创设计按“批次 → 匿名评审 → 验证 → 冻结”执行；其余来源按来源特定检查进入同一冻结机制。
- 来源变更会自动清除旧验证与发布决策，不能借用旧证据发布新工件。

## 启动验收

1. 配置 `.env` 中的 `SEMOVIX_LIBRARY_DIR`、`SEMOVIX_WORKER_URL` 和全部本地 checkpoint 路径。
2. 执行 `python worker/doctor.py`；任何 FAIL 都要先修复，不能进入验收。
3. 启动 Worker：`cd worker && ./启动Worker.command`。
4. 执行 `npm run build`，再以 `NODE_ENV=production npm run start:production` 启动服务。
5. 运行：

   ```bash
   npm run lint
   npm run test:unit
   npm run test:integration
   python3 -m pytest worker/tests/test_worker.py -q
   npm run smoke:local
   ```

6. 用一个测试角色完成来源配置、验证、人工回听确认、冻结版本，并重新读取 Profile Manifest 和参考音频，确认 Hash 校验成功。

## 部署边界

服务默认只绑定回环地址。上线到多用户环境前，运维侧必须在反向代理和基础设施中提供：身份认证、TLS、租户隔离、角色权限、对象存储、集中审计、文件恶意内容扫描、密钥管理、备份恢复和受控任务队列。当前代码不会把本地目录或 Worker 端口直接暴露到公网。
