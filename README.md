# Voice Studio

Voice Studio 是一套本地优先的声音资产工作台。声音角色流程把角色定义、来源配置、AI 原创设计、匿名评审、稳定性验证和不可变 Voice Profile 发布串成可追溯的闭环。

## 本地运行

安装依赖后，可使用单进程模式：

```bash
npm run dev
```

它在 `http://127.0.0.1:3000` 同时提供前端和 API。

也可把浏览器预览和 API 服务分开运行：

```bash
npm run dev:api
npm run dev:web
```

浏览器预览会把 `/api` 代理到 `http://127.0.0.1:3210`。通过 `SEMOVIX_API_URL` 可覆盖代理目标。

Python Worker 负责 Qwen3-TTS 和 Whisper：

```bash
cd worker
./启动Worker.command
```

Worker 默认位于 `http://127.0.0.1:8800`，可通过 `SEMOVIX_WORKER_URL` 覆盖。模型目录与其他环境变量见 [.env.example](.env.example)。
AI 原创设计、授权真人克隆和 Whisper 分别需要 VoiceDesign、Base 与 Whisper 权重；`python worker/doctor.py` 会逐项报告本地 checkpoint 或首次下载需求，不能通过体检时不应启动生产任务。

## 声音角色交付链路

1. 创建声音角色并保存来源配置。四种来源共享同一工作台外壳：AI 原创设计、授权真人克隆、Provider 预置音色和导入已有 Voice Profile。
2. AI 原创来源创建一个不可变的声音设计批次；候选仅通过随机匿名编号进入评审。
3. 评审记录每条候选的七项分数、硬性否决、备注和入围结果。
4. 验证任务以入围候选的 WAV 为 Base 参考音，生成五组内容测试和三次重复测试；每条输出都保存 WAV、SHA-256、时长、波形摘要和 Whisper 转录。
5. 责任人完整回听后保存发布决策。只有自动验证通过且有人工确认的候选可以冻结。
6. 冻结操作复制最终参考 WAV 和验证报告，并写入不可变 Manifest 与 SHA-256 校验文件。

授权真人克隆另有授权文件、有效期、用途边界、参考音频、参考文本和样本质量检查；没有有效归档授权不能上传样本或生成克隆样音。

Provider 预置音色只从已连接 Worker 的运行时目录读取官方 speaker ID。选择时必须保存 Provider、许可确认、非独占性确认和允许/禁止用途；试听样音为真实生成的 WAV，并与选择记录一起归档。来源验证会再次核验运行时 speaker、试听音频 Hash 和 ASR 回听结果。

导入已有 Voice Profile 只接受 ZIP 包。服务端要求包内有 `manifest.json` 和 Manifest 声明的单声道 16-bit PCM WAV，并声明生产模型、允许用途和禁止用途；服务端限制上传和解压大小、拒绝不安全路径、校验参考音频 SHA-256，并在每次读取参考音频前再次校验归档 Hash。当前工作台只接受可验证的 Qwen CustomVoice 或 Base Profile；不兼容模型会如实阻断发布。

授权真人克隆、Provider 预置音色和导入 Profile 都会进入统一“验证与发布”入口。验证记录会保存来源快照、实际音频、Hash、运行时目录或模型兼容性检查，以及可用时的 Whisper 回听结果。来源资料、授权、样音或使用边界发生变化后，旧验证与发布决策会自动失效；未重新验证不能冻结新版本。Provider 试听和来源验证任务的队列状态会落盘，服务重启后会自动恢复。

## 验证

```bash
npm run lint
npm run test:unit
npm run test:integration
python3 -m pytest worker/tests/test_worker.py -q
npm run build
```

## 受控环境交付

构建产物包含浏览器静态文件和 Node 服务包：

```bash
npm run build
NODE_ENV=production npm run start:production
```

服务默认仅监听 `127.0.0.1`。受控内网部署应由反向代理承担 TLS 与身份认证，并将 Node 服务和 Python Worker 保持在同一受限网络；Worker 端口不能直接暴露。启动前执行 `python worker/doctor.py`，确认 VoiceDesign、Base、CustomVoice 与 Whisper 所需的 checkpoint 已可用。发布前应执行上述完整测试集和 `npm run smoke:local`。

## 上线前配置

当前实现按本地优先方式持久化音频、授权文件、批次和 Profile，适合单机或受控内网交付。部署到多用户环境前，需要把本地文件目录替换为受权限控制的对象存储，并接入身份认证、租户隔离、角色权限、审计日志汇聚、恶意文件扫描、密钥管理和受控任务队列。上线服务不得通过当前默认的 `127.0.0.1` 监听直接暴露到公网。
