# Ali 音乐机器人 EQ

2026-10-04：将 OCI 的十段 EQ 移植到 Ali 当前源码 af4ca56，保留 TS6 profile 修复和较新界面功能。OCI 生产服务未修改。

桌面：播放时点击音量旁的均衡器按钮。手机：点击音量，再点击 EQ。
每段 -12 到 +12 dB；前级 -24 到 0 dB。新机器人默认关闭、平直；每个机器人独立保存。
调整在服务器 PCM 到 Opus 链路实时应用，不需要重新播放。
沿用现有 player.control、机器人访问范围及游客 transport 权限。

## 构建与部署

标准构建：npm ci；npm --prefix web ci；npm run build。
本次锁文件完全一致，使用 OCI 隔离构建目录的现有依赖完成 TypeScript/Vue 构建。
Ali 镜像以原生产 AMD64 镜像 tsmusicbot:before-eq-20261004 为基础，仅替换 dist 和 web/dist。
使用 scripts/docker/Dockerfile.ali-eq 构建；同名 .dockerignore 限定构建上下文。
部署镜像：tsmusicbot:ali-eq-20261004-final。
Compose：/root/teamspeak/docker-compose.yml，只修改 tsmusicbot.image。
仅重建/重启 tsmusicbot；未重启两台 TeamSpeak 服务。
数据卷：teamspeak_tsmusicbot-data。数据库仅增加每机器人 equalizer 设置列。
生产上已有用户调整的 EQ 设置予以保留。

## 连接生命周期修复

原生产镜像包含源码未提交的异步连接拆除修复，本次先恢复至源码再移植。
部署时发现旧版主进程在断开完成前直接退出，服务器保留旧会话至 ping 超时，新握手暂时无法完成。
现关闭流程等待所有机器人断开，并提供 8 秒退出期限。
曾临时回滚恢复服务；最终镜像重新连接后，完成真实停止/启动验证：
停止耗时 1.42 秒，服务端旧机器人会话数立即变为 0；启动后 3 秒自动连接，只有 1 个会话。

## 验证

最终源码测试：npm test -- src --reporter=dot，76 文件、1184 项通过。
TypeScript/Vue 类型检查与生产构建通过。
最终 AMD64 镜像的隔离容器使用生产数据库副本，断网且禁用自动连接。
真实 HTTP API 保存、非法输入拒绝、未认证拒绝与重启恢复通过。
连续 PCM→EQ→Opus→解码实测：1 kHz 设定 +6 dB，测得 +5.95 dB；100 帧连续处理。
浏览器隔离预览验证十段面板、启用和保存。未进行真人耳机听音评测。
生产检查：机器人已连接且播放中，十段 EQ 读写返回 200；账户、权限、机器人原字段、收藏和保存歌单与备份一致。
播放队列在操作期间存在用户更新，保留最新队列，未覆盖回旧快照。
观察到一次头像更新 file already in use (2058) 警告，不影响 EQ 和播放；未为此改动频道或权限。

## 备份和回退

备份目录：/root/teamspeak/.backups/eq-port-20261004T021945Z/。
保留原 Compose、原镜像、完整数据快照、部署前校验和最终 verification.json。
如需回退代码，只把 Compose 的 bot image 恢复为 tsmusicbot:before-eq-20261004，再重建 bot。
不要直接恢复旧数据快照，以免覆盖部署后的用户更改。
