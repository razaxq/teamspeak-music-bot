# 耳机虚拟环绕

2026-10-04，在 Ali 已部署 EQ 版本 5ba5bab 的基础上增加。
入口：桌面播放器 EQ 旁的耳机按钮；手机音量菜单中的环绕。
默认关闭；空间强度 60%，房间感 25%；每个机器人独立保存，开关保留调节值。
作用范围为此机器人的所有听众，不是每人独立效果。推荐使用立体声耳机。

实现：48 kHz 双声道，0.25 ms 耳间延迟、对侧耳低通和有限长度早期反射。
它是轻量双耳空间模拟，不是实测 HRTF 卷积、头部追踪或离散 5.1/7.1。
链路：PCM → EQ → 环绕 → 音量/ducking → 唯一一次 s16 量化 → Opus。
空间混合权重归一化，无反馈回路；20 ms 平滑切换，停播/切歌清空历史。
不增加整段输出缓冲延迟；反射分量使用 11–23 ms 延迟。

新增接口：GET/POST /api/player/:botId/surround。
设置格式：{ enabled: boolean, strength: 0..100, room: 0..100 }。
沿用机器人访问范围、player.control 和游客 transport 权限。
数据库 bot_instances 新增 surround TEXT；默认 NULL 读为关闭，不改原 EQ 或其他字段。
保存先写数据库，成功后更新音频处理并广播状态。

验证：79 个源码测试文件、1215 项通过；TypeScript/Vue 类型检查和生产构建通过。
最终 AMD64 镜像隔离测试：认证、非法输入拒绝、设置保存、重启恢复和 EQ 保留通过。
真实 PCM→Opus→解码：只给左声道信号，右声道 RMS 在启用前/启用/关闭后为 0 / 1329.05 / 0，180 帧连续输出用时约 3.61 秒。
该测试确认处理与旁路有效，不代表主观听感或个体 HRTF 匹配。
桌面和 390px 手机界面已检查，启用、滑块保存、关闭重开和手机入口正常。

构建镜像：tsmusicbot:ali-surround-20261004。
基础镜像：tsmusicbot:ali-eq-20261004-final，保留 AMD64 原运行依赖和正常断开修复。
Dockerfile：scripts/docker/Dockerfile.ali-surround；无新第三方依赖。
源码工作树：/opt/teamspeak-music-bot-surround。
只更新 /root/teamspeak/docker-compose.yml 的机器人镜像并重建机器人。
原 EQ 镜像、备份和新部署验证记录保留于 /root/teamspeak/.backups/ 下。
