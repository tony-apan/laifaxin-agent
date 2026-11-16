# laifaxin-agent

来发信开放服务 —— 为 AI Agent 打造的来发信操作通道。装好 Skill 之后，你的 Agent 就能直接在你的来发信账号里搜客户、管联系人、处理邮件和营销任务，你只管下指令、看结果。

接入站：**https://agent.laifa.xin**

## 一键接入

将以下提示词发送到你的 Agent 对话窗口，根据引导完成安装和授权：

```text
请阅读 https://agent.laifa.xin/doc/skill-setup.md 文档，按照步骤为我安装并配置来发信 Skill。
```

技术用户也可以一行命令安装（自动发现、校验、落位）：

```bash
npx skills add https://agent.laifa.xin -g -y
```

安装全程走接入站，不依赖 GitHub 的访问速度；本仓库是真源与备用镜像，接入站内容由本仓库 `site/` 自动同步部署。

## 手动下载

当前版本 **v6.1.28**（接口目录 webVersion 6.1.28），要求 Python 3.10+ 与能执行本机脚本的 Agent 宿主。

| 通道 | 地址 |
| --- | --- |
| 本站下载（推荐） | https://agent.laifa.xin/releases/laifaxin-v6.1.28.zip |
| GitHub Release | https://github.com/tony-apan/laifaxin-agent/releases |

SHA256：`00faebdc95599b56bfd76d57f425f4c867654609b148c3ef76e6743ef08b8e9f`（两通道字节一致）

安装文档：https://agent.laifa.xin/doc/skill-setup.md（仓库内副本在 `site/doc/skill-setup.md`）

## 仓库结构

- `laifaxin/` — Skill 包本体：`SKILL.md`、Python 客户端 `scripts/laifaxin.py`（纯标准库、零依赖）、接口目录与契约快照 `references/`
- `site/` — 接入站 agent.laifa.xin 的站点源（Cloudflare Pages）

## 授权与安全

- 采用网页设备授权（`api.laifaxin.com/authorize`）：Agent 不接触你的账号密码，凭据只保存在你本机 `~/.config/laifaxin-skill/`（权限 600），有效期 30 天。
- 每个账号最多 10 个有效凭据；可随时在来发信网页端「个人设置 → 安全设置 → 已授权应用」撤销，或运行 `laifaxin.py logout`。
- 发送、群发等写操作按 Skill 内的授权边界执行：没有你的明确指令，Agent 不会发出邮件。

## 反馈

使用问题请提 Issue，或到来发信网页端联系客服。
