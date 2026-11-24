# 来发信 Skill 安装说明

来发信开放服务：让 AI 助手通过来发信接口帮你搜客户、管联系人、处理邮件与营销任务。本页只写安装与连接的必要信息；连接细节与使用规则以技能包内的 `references/connection.md` 为准。

## 你需要什么

- 一个能运行命令的 AI 助手环境（Codex、Claude Code、Cursor、WorkBuddy 等）。没有命令执行能力的助手装不了，请如实告诉用户，建议改用来发信网页端。
- Python 3.10 或以上（技能脚本运行需要）。
- 安装走本站 `agent.laifa.xin`，授权与业务接口走 `api.laifaxin.com`，授权确认在来发信网页端完成。不要把密码、验证码或凭据粘贴到聊天里。

## 第 1 步：安装

有 Node.js 的环境，运行：

```bash
npx skills add https://agent.laifa.xin -g -y
```

装到 `~/.agents/skills/laifaxin`，并自动链接到当前助手的 skills 目录。升级时重复运行同一条命令（覆盖重装）。

npx 从 npm 拉取工具超时，可换镜像源重试一次（这只解决 npm 工具拉不下来的问题；本站本身打不开时，走下面「GitHub 兜底」）：

```bash
npx --registry https://registry.npmmirror.com skills add https://agent.laifa.xin -g -y
```

### 没有 Node 时：手工安装

1. 找到助手宿主的 skills 目录（Codex 为 `~/.codex/skills`，Claude Code 为 `~/.claude/skills`，WorkBuddy 为 `~/.workbuddy/skills`；Cursor 等其他宿主优先走上面的 npx 安装、会自动链接，手工安装时按其官方说明找 skills 目录）。找不到就停下来问用户，不要猜路径。
2. 下载安装包并校验，校验不一致就停，不要安装：

```bash
curl -L -o /tmp/laifaxin.zip "https://agent.laifa.xin/releases/laifaxin-v6.1.30.zip"
echo "374ffc3b9c2ea7d475de2f1d6c0b42a33c57e9418ace465970073d4b966ecd3c  /tmp/laifaxin.zip" | sha256sum -c -
```

macOS 没有 `sha256sum` 时用 `shasum -a 256 -c -`。

3. 解压到 skills 目录，解压后应有 `<skills 目录>/laifaxin/SKILL.md`：

```bash
unzip -o /tmp/laifaxin.zip -d <skills 目录>
```

### 本站打不开时：GitHub 兜底

改用官方仓里的同一份安装包：`https://raw.githubusercontent.com/tony-apan/laifaxin-agent/main/site/releases/laifaxin-v6.1.30.zip`。换源先告诉用户；下载后按上面的 SHA256 校验，一致才装。两个来源都打不开就停下来说明，不要从其他来源找包。

手工安装与兜底安装的用户，升级时重新打开本页，按当期版本号下载新包，并核对本页当期给出的校验值（本页随版本更新）；解压前先删掉旧的 `laifaxin` 目录再解压，避免旧文件残留。

## 第 2 步：连接账号

技能自带连接说明（包内 `references/connection.md`），按它执行即可。概要是三条命令：

```bash
LFX="$HOME/.agents/skills/laifaxin/scripts/laifaxin.py"
python3 "$LFX" configure
python3 "$LFX" login
python3 "$LFX" status
```

手工安装的，把 `LFX` 换成 `<skills 目录>/laifaxin/scripts/laifaxin.py`。

`login` 会给出授权链接和用户码：把链接和用户码原样发给用户，用户在网页登录、核对用户码一致、选择工作区并点「允许授权」；用户确认后运行 `python3 "$LFX" login --resume` 领取凭据。没有桌面或远程环境时，`login` 改用 `login --no-browser`，返回的链接和用户码相同。`status` 显示账号与工作区就是连接成功。用户还没确认时不要声称已连接，也不要重新运行 `login`。

## 装好之后

- 网页端：https://web.laifaxin.com
- 撤销授权：网页端「个人设置 → 安全设置 → 已授权应用」，或运行 `python3 "$LFX" logout`。
- 凭据只存在本机 `~/.config/laifaxin-skill/`（权限 600），有效期 30 天，到期重走第 2 步。

## 遇到问题

客服邮箱 help@zhijixinxi.com，电话 17091913071。
