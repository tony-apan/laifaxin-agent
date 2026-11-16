# 来发信 · 开放服务

让 AI 助手替你操作来发信。把一句话发给你的 AI 助手，它就能在你的来发信账号里搜客户、管联系人、处理邮件。你只管交代工作，看结果。

接入站：https://agent.laifa.xin

## 接入

将下面这句话复制到你的 AI 助手对话框，安装与配置由它自动完成：

```text
请阅读 https://agent.laifa.xin/doc/skill-setup.md 文档，按照步骤为我安装并配置来发信 Skill。
```

支持 Codex、Claude Code、Cursor、WorkBuddy 等主流 AI 助手。安装走接入站完成，不依赖 GitHub 的访问速度；本仓库是源文件与备用镜像。

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

授权经来发信官方网页完成（`api.laifaxin.com/authorize`），AI 助手不接触你的账号密码。授权凭据只保存在你自己的电脑上（`~/.config/laifaxin-skill/`，权限 600），30 天有效，每个账号最多 10 个；可随时在来发信网页端「个人设置 → 安全设置 → 已授权应用」中撤销。发送、群发等写操作只在你明确交代时执行。

## 技术资料

仓库结构：

- `laifaxin/` — Skill 本体：`SKILL.md`、Python 客户端 `scripts/laifaxin.py`（纯标准库、零依赖，Python 3.10+）、接口目录与契约快照 `references/`
- `site/` — 接入站站点源；推送到 main 后由 GitHub Actions 自动部署到 Cloudflare Pages

手动安装（无 Node.js 环境时的备选）：当前版本 v6.1.28，从[接入站](https://agent.laifa.xin/releases/laifaxin-v6.1.28.zip)或 [GitHub Release](https://github.com/tony-apan/laifaxin-agent/releases) 下载 zip，解压到 Agent 的 skills 目录。SHA256：`00faebdc95599b56bfd76d57f425f4c867654609b148c3ef76e6743ef08b8e9f`（两处字节一致）。

安装文档全文：https://agent.laifa.xin/doc/skill-setup.md（仓库内副本在 `site/doc/skill-setup.md`）。

## 反馈

使用问题请提 Issue，或到来发信网页端联系客服。
