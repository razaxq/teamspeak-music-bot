# Ali 音乐机器人 EQ

2026-10-04：将 OCI 的十段 EQ 移植到 Ali 当前源码 af4ca56，保留 TS6 profile 修复和较新界面功能。

桌面：播放时点击音量旁的均衡器按钮。手机：点击音量，再点击 EQ。
每段 -12 到 +12 dB；前级 -24 到 0 dB。默认关闭、平直；每个机器人独立保存。
调整在服务器 PCM 到 Opus 链路实时应用，不需要重新播放。
沿用现有 player.control、机器人访问范围及游客 transport 权限。

构建：npm ci；npm --prefix web ci；npm run build。
Ali 镜像以原生产 AMD64 镜像 tsmusicbot:before-eq-20261004 为基础，仅替换 dist 和 web/dist。
使用 scripts/docker/Dockerfile.ali-eq 构建；同名 .dockerignore 限定构建上下文。

验证：76 个测试文件、1197 项通过；TypeScript/Vue 类型检查及生产构建通过。
隔离 AMD64 容器使用生产数据库副本，断网且禁用自动连接。真实 HTTP API 保存、输入校验、认证与重启恢复通过。
连续 PCM→EQ→Opus→解码实测：1 kHz 设定 +6 dB，测得 +5.95 dB；100 帧连续处理。
尚未进行真人耳机听音评测。
