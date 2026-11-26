# 发布规则

本仓发布「来发信开放服务 Skill 包」。

本仓发布遵循 agent-collab《Q-015 分发包发布通则》（版本：v0.4.1，位置：`tony-apan/agent-collab` 仓 `rules/sop-annex-release-generics.md`，2026-11-22 经 Tony 批准对本仓生效）。本文件仅记录本仓特有内容：发版脚本位置、公布面地址清单、渠道清单、渠道差异登记的引用。

四条铁律与发版检查清单已迁入通则（事故复盘见通则第 8 章），本文件不再复制条文。

## 本仓特有内容

- 收尾闸脚本：`tools/verify-release.sh <版本号>`——从公网下载正式包、按 `.sha256` 校验、扫描全部公布面有没有与真源不一致的校验码，并跑真装验证（见下）。闸不过，不许宣布发布完成。
- 校验码真源：`site/releases/<包名>.zip.sha256`，由打包环节生成；其他任何地方不许写死校验码数字。
- 发版后按安装文档从公网完整执行一次「下载 → 校验 → 解压」，验证结果记入当次发版记录。
- **双索引收敛（2026-11-26 根治）**：两份发现索引（`.well-known/skills/index.json` 散文件版、`.well-known/agent-skills/index.json` 压缩包版）只许由 `tools/build-indexes.py <版本号>` 从实物机械生成，禁止手改；真源是 `laifaxin/` 源码树，脚本同时断言散文件树、releases zip、well-known zip 三处逐字一致。打包后、推送前必跑（写模式），核验时可跑 `--check`。
- **真装闸（2026-11-26 根治）**：`tools/verify-install.sh <版本号>` 在隔离 HOME 里实际运行官方一键安装命令全程，断言装齐文件数与索引声明、zip 一致且逐字相同，结果记入 `docs/install-verifications.log`。verify-release.sh 第 4 步自动调用；不过不许宣布发布完成——「包没坏」不等于「装得上」。
- **每日巡检（2026-11-26 根治）**：`tools/patrol-discovery.py` 按发现索引的解析规则逐条探活（不探猜测路径），并校验 V2 索引 digest 与当版包哈希；由每日定时任务运行，全通静默、任一失败当日报警。
