# 来发信-外贸获客与开发信助手

[![版本 v6.1.29](https://img.shields.io/badge/%E7%89%88%E6%9C%AC-v6.1.29-1B6DE0?style=flat-square)](https://github.com/tony-apan/laifaxin-agent/releases/tag/v6.1.29) [![接入站 agent.laifa.xin](https://img.shields.io/badge/%E6%8E%A5%E5%85%A5%E7%AB%99-agent.laifa.xin-1B6DE0?style=flat-square)](https://agent.laifa.xin) [![授权 官方网页](https://img.shields.io/badge/%E6%8E%88%E6%9D%83-%E5%AE%98%E6%96%B9%E7%BD%91%E9%A1%B5-1B6DE0?style=flat-square)](https://agent.laifa.xin/doc/skill-setup.md) [![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-607D8B?style=flat-square)](#技术资料) [![依赖 零依赖](https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-%E9%9B%B6%E4%BE%9D%E8%B5%96-607D8B?style=flat-square)](#技术资料)

让 AI 助手帮你找海外客户、写开发信、发邮件、跟进客户，重复活交给它，每一步由你拍板。把一句话发给你的 AI 助手，它就能在你的来发信账号里开始干活。

## 接入

将下面这句话复制到你的 AI 助手对话框，安装与配置由它自动完成：

```text
请阅读 https://agent.laifa.xin/doc/skill-setup.md 文档，按照步骤为我安装并配置来发信 Skill。
```

支持 Codex、Claude Code、Cursor、WorkBuddy 等主流 AI 助手。一行安装需要 Node.js 环境；没有 Node.js 时可用手动安装（见下方「技术资料」）。

也可以在技能市场里直接安装：[SkillHub](https://skillhub.cn/skills/org-t67ewudl/laifaxin)（腾讯技能社区）；用 WorkBuddy 的，在客户端技能市场里搜「来发信」即可。

本仓库是本 Skill 的唯一真源：接入站由本仓库自动部署，安装全程走接入站完成，不依赖 GitHub 的访问速度。

## 使用方式

1. **复制一句话** — 将接入提示词发给你的 AI 助手，你不需要做任何设置。
2. **网页授权** — 打开助手给出的链接，登录来发信，核对用户码后确认授权。你的密码不经过助手。
3. **开始使用** — 连接成功后，像平常说话一样交代工作：「帮我搜一批德国的照明行业客户」「看看最近有哪些新邮件」。

## 能做什么

| 功能 | 说明 |
| --- | --- |
| 搜客户 | 按国家与行业检索海外企业与联系人，筛选之后保存到通讯录 |
| 管客户 | 联系人、公司、标签与跟进记录，统一整理，随时调取 |
| 处理邮件 | 阅读、撰写、回复与定时发送，邮件打开情况可以追踪 |
| 做跟进 | 批量开发信与自动跟进计划，执行结果形成报告 |

## 安全

- 授权经来发信官方网页完成（`api.laifaxin.com/authorize`），AI 助手不接触你的账号密码。
- 授权凭据只保存在你自己的电脑上（`~/.config/laifaxin-skill/`，权限 600），30 天有效，每个账号最多 10 个。
- 可随时在来发信网页端「个人设置 → 安全设置 → 已授权应用」中撤销。
- 发送、群发等写操作，只在你明确交代时执行。

## 技术资料

**仓库结构**

- `laifaxin/` — Skill 本体：`SKILL.md`、Python 客户端 `scripts/laifaxin.py`（纯标准库、零依赖，Python 3.10+）、接口目录与契约快照 `references/`
- `site/` — 接入站站点源（含安装文档与双协议发现索引 `.well-known/`）
- `.github/workflows/` — 部署流水线

**手动安装**（无 Node.js 环境时的备选）

当前版本 v6.1.29，从 [接入站](https://agent.laifa.xin/releases/laifaxin-v6.1.29.zip) 或 [GitHub Release](https://github.com/tony-apan/laifaxin-agent/releases) 下载 zip，解压到 Agent 的 skills 目录。

SHA256：`a6e65853b4a9db229ba746631ba5163f4deae253484e711b242cf886671f10bb`（接入站与 GitHub 仓为同一份包，两处下载均可按此校验）

**版本与更新**

- 更新方式：重新运行一行安装命令即可升级到最新版；已用 skills CLI 安装的也可通过它自带的更新命令升级。
- 部署管线：推送到 main 后，EdgeOne Pages 自动部署接入站为正式面；GitHub Actions 同步部署 Cloudflare Pages 作回滚热备。

安装文档全文：https://agent.laifa.xin/doc/skill-setup.md （仓库内副本在 `site/doc/skill-setup.md`）。

## 反馈

使用问题请提 Issue，或到来发信[网页端](https://web.laifaxin.com)联系客服（邮箱 help@zhijixinxi.com）。
