# 应用内更新

采用 electron-updater 的 Windows NSIS / GitHub provider，固定指向 lhljpt-web/hongguo-manju-desktop。相较自行编写安装器下载器，可复用版本比较、SHA-512 校验、缓存和 NSIS 升级；仅打开网页不满足应用内更新需求。

- 启动 10 秒后检查，运行期间每 4 小时检查；同时保留手动入口。
- 发现更高版本后自动下载，显示进度；失败可重试。包含本仓库测试版，不允许降级。
- 下载完成后用户点击“重启安装”；普通退出不安装，不在观看过程中强制重启。
- 沿用现有退出保存流程，关闭窗口、保存观看记录和关闭媒体后才启动安装程序。升级保留 userData 和固定播放标识。
- 独立 UpdateService 管理状态；renderer 只能检查、查询状态、重试下载、请求安装，不能指定 URL 或路径。
- 发布 exe 和 latest.yml；SHA-512 校验与 HTTPS 保护传输一致性。当前安装包未配置发布者签名，不声称有发布者身份认证。
- 开发模式禁用更新，测试使用隔离安装目录与数据；不添加生产环境任意更新源开关。

实施及验收：先测试状态、并发、失败重试和安装前置条件；实现 IPC 和更新面板；构建并核对 app-update.yml/latest.yml；隔离安装验证实际检查、下载校验、安装重启与数据保留；发布 0.2.3 安装包和更新元数据，更新安装说明。

技术依据：electron-updater 6.8.9 的 AppUpdater、BaseUpdater、NsisUpdater 和 GitHubProvider 实现；electron-builder 26 的 NSIS 发布元数据生成。0.2.2 没有更新器，必须手动覆盖安装一次。
