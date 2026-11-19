# laifaxin-skill

来发信开放服务 — 让 Agent 通过来发信现有 Web 接口搜索客户、管理联系人、处理邮件与营销任务。

## 快速开始（AI Agent）

业务操作只访问两个站点：`agent.laifa.xin`（安装）和 `api.laifaxin.com`（授权与业务接口）；只有两个例外——本站不可达时按备选步骤走 GitHub 镜像下载安装包，授权确认与账号管理在来发信网页端 `web.laifaxin.com` 完成。不要让用户把密码、验证码或凭据粘贴到聊天里。运行环境需要 Python 3.10+ 跑业务脚本；没有脚本/网络能力的宿主只能提供业务建议，不要声称已连接。

### 第 1 步 — 安装 Skill（首选：一行命令）

有 Node.js / npx 的环境，运行：

```bash
npx skills add https://agent.laifa.xin -g -y
```

它会自动发现本站的 Skill、校验完整性、安装到 `~/.agents/skills/laifaxin` 并链接到你当前宿主的 skills 目录，不要再手工下载或解压。若 npx 从 npm 拉取 skills 包超时，先运行 `npm config set registry https://registry.npmmirror.com` 再重试，或改走下面的备选手工安装。若访问本站失败（超时、连接错误或 403），不要反复重试，改走下文备选步骤里的 GitHub 镜像。下文 `$LFX` 指：

```bash
LFX="$HOME/.agents/skills/laifaxin/scripts/laifaxin.py"
```

以后升级重复运行同一条命令，或运行 `npx skills update laifaxin -g -y`。

### 第 1 步（备选）— 无 Node 环境时手工安装

先定位你当前宿主的 skills 目录（Codex 约为 `~/.codex/skills`，Claude Code 约为 `~/.claude/skills`，WorkBuddy 约为 `~/.workbuddy/skills`）。自动探测：

```bash
SKILLS_DIR=""
for d in "$HOME/.codex/skills" "$HOME/.claude/skills" "$HOME/.workbuddy/skills"; do
  if [ -d "$d" ]; then SKILLS_DIR="$d"; break; fi
done
echo "$SKILLS_DIR"
```

探测不到时停下来，向用户说明并请其提供本宿主的 skills 目录，不要猜路径、不要装到其他位置。然后下载、校验、解压（zip 内顶层目录为 `laifaxin/`，解压后应得到 `$SKILLS_DIR/laifaxin/SKILL.md`）：

```bash
TMPDIR=$(mktemp -d)
curl -L -o "$TMPDIR/laifaxin.zip" "https://agent.laifa.xin/releases/laifaxin-v6.1.28.zip"
echo "708b7fab6f1b210f0f79a94a47a6b86394622f7a58fc2a8b044320d46442bb6d  $TMPDIR/laifaxin.zip" | sha256sum -c -
mkdir -p "$SKILLS_DIR"
unzip -o "$TMPDIR/laifaxin.zip" -d "$SKILLS_DIR"
rm -rf "$TMPDIR"
LFX="$SKILLS_DIR/laifaxin/scripts/laifaxin.py"
```

校验失败立即停止，不要继续安装。macOS 无 `sha256sum` 时用 `shasum -a 256 -c -`。本站不可达时可用 GitHub 镜像（链接直达 zip；下载后必须按上文给出的 SHA256 校验，校验不过不要安装）：`https://raw.githubusercontent.com/tony-apan/laifaxin-agent/main/site/releases/laifaxin-v6.1.28.zip`；镜像也不可达时停下来向用户说明，不要从其他来源找安装包。

### 第 2 步 — 配置连接

```bash
python3 "$LFX" configure
```

默认连接 `https://api.laifaxin.com/api`，只保存本机连接设置，不接触账号密码。

### 第 3 步 — 网页授权

```bash
python3 "$LFX" login
```

执行要求（必须遵守）：

- 这是交互流程。命令返回授权链接 `url` 和用户码 `user_code` 后，把链接视为不可修改的原始字符串，单独放在一个代码块里展示给用户，并同时展示用户码供核对；不要对链接做编码、解码、拼接或加标点。
- 提示用户：点击链接，在网页登录来发信，核对网页与此处显示的用户码一致，选择工作区，勾选确认并点「允许授权」。打开链接不等于已授权。
- 命令返回 `state: pending` 表示用户尚未确认，**不要声称已连接**，也不要重新运行 `login` 发起新请求。用户确认后运行下面的命令继续领取凭据（沿用原请求）：

```bash
python3 "$LFX" login --resume
```

- 远程或无桌面环境的宿主改用 `login --no-browser`，同样按上面规则展示链接与用户码。
- 授权失败或过期时把后端错误原样反馈给用户，不要改用密码登录，不要读取浏览器 Cookie 或会话。

### 第 4 步 — 验证

```bash
python3 "$LFX" status
```

自检要点（先做完再报成功）：

- `python3 "$LFX" catalog` 应返回接口目录（当前 417 个操作，webVersion 6.1.28）；`describe` 的参数是**端点路径**（如 `describe /account/info`），不是操作名，传操作名会报「不在契约中」。
- `workspaces` 等只读命令偶发 `network_error` 多为瞬时网络问题，只读操作可重试一次；写操作不自动重试（按 Skill 内规则先查询结果）。

`status` 返回 `ok` 后，只需输出以下内容（把 xxx 换成返回的实际账号与工作区）：

- 已连接来发信，账号 xxx、工作区 xxx，可以开始用我处理客户与邮件了
- 你可以试试以下指令：
  - 帮我搜一批德国的照明行业客户
  - 帮我看最近的客户保存记录
  - 帮我整理联系人并打上标签

验证失败则输出失败信息与后端提示，不要输出成功话术。

## 管理端

- 来发信网页端：https://web.laifaxin.com
- 撤销授权：网页端「个人设置 → 安全设置 → 已授权应用」，或运行 `python3 "$LFX" logout`
- 凭据只保存在用户本机 `~/.config/laifaxin-skill/`（权限 600），有效期 30 天，到期重新执行第 3 步。
