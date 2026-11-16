# 连接与本机凭据

本包默认使用来发信网页授权，领取可单独撤销的应用凭据；业务操作仍调用现有 Web 接口并沿用账号权限。下列命令由用户在支持本机脚本的 AI 宿主或终端运行。`$LFX` 是已安装的 `scripts/laifaxin.py` 绝对路径。

## 首次配置

Skill 默认连接 `https://api.laifaxin.com/api`，网页授权地址为 `https://api.laifaxin.com/authorize`，请求中的 `host` 为 `api.laifaxin.com`。首次使用执行以下命令。

```sh
python3 "$LFX" configure
python3 "$LFX" login
python3 "$LFX" status
```

申请、轮询、取消和撤销统一发送 `client_id=laifaxin`，授权页应用名称为「来发信开放服务」。服务端需登记此 ID；客户端不会回退到旧 ID `laifaxin-skill`。升级前签发的旧 ID 凭据和待确认请求不能继续使用：在网页「已授权应用」中撤销旧记录，再运行 `login` 重新授权，不使用 `login --resume` 延续旧请求。历史记录仍保留，未过期且未撤销的旧记录仍占凭据名额。

`configure` 只保存本机连接设置。`login` 默认打开服务端返回的 `verification_uri_complete` 一键授权链接，自动带入本次用户码。用户在网页完成登录，核对网页与客户端显示的用户码一致，再选择工作区、勾选核对确认并允许授权。打开链接不会自动批准授权。Skill 不读取网页会话，也不接触用户密码。

一次最多等待 30 秒；尚未确认时返回 `state:pending`，不能说已连接。用户确认后运行 `python3 "$LFX" login --resume` 继续领取凭据。远程或无桌面的宿主运行 `login --no-browser`，把返回的 `url` 作为一键授权入口，并同时展示 `user_code` 供核对；`device_code` 仅保存本机，不能展示或复制到网页。

手动输入仅作备用：链接无法使用时，让用户打开返回的 `verification_uri`，输入同一 `user_code`（忽略大小写和连字符），继续核对和确认。若旧站点未返回完整链接，客户端直接打开手动输入页。`authorization_required` 和 `pending` 输出均包含 `url`、`user_code`、`verification_uri`，重试 `--resume` 沿用原请求，不重新申请或延长十分钟有效期。客户端会校验链接站点、路径和用户码；链接不匹配时停止连接。

新授权码由 10 位大写字母组成，每 5 位一组，共 2 组。旧版六组用户码不再接受；升级前尚未完成的请求需重新运行 `login`。授权请求 10 分钟内有效，独立凭据有效期 30 天，无自动续期。到期重新 `login`。断开连接运行 `logout`，会先在服务端撤销凭据，再清除本机配置；失败时保留配置并显示后端错误。网页的「个人设置 → 安全设置 → 已授权应用」也能随时撤销。

领取凭据时，`authorization_pending` 保持原间隔；`slow_down` 每次将轮询间隔增加 5 秒。网络超时、HTTP 5xx、429 和 HTTP 200 的“操作频繁”会等待后重试；临时故障的等待逐步增加，遵守 `Retry-After`。每次 `login` 只在 `--wait` 的时间预算内串行轮询，返回 `pending` 后保留原设备码、下次请求时间及原始到期时间，使用 `login --resume` 继续。拒绝、过期、无效请求及配置错误不会自动重试；过期后需重新运行 `login`。不要把等待中的连接报告为已成功。

每个账号最多 10 个有效凭据，跨应用、站点及工作区累计；已过期或已撤销的记录不占名额。遇到 `grant_limit_reached`，向用户显示后端提示和 `manage_url`；在授权所属站点撤销不再使用的记录后，仍可在原请求的十分钟有效期内继续领取，不能自动撤销其他授权。本站列表仅显示本站记录。

访问凭据作为不透明字符串保存和发送，不依赖固定前缀或长度。当前服务端签发 `laifaxin_auth_` 凭据，有效期 30 天；旧客户端 ID 或旧前缀凭据需要重新授权。取消和撤销允许在 30 秒内重试同一请求，未确认撤销成功时保留本机凭据。以上重试仅限授权流程，不自动重试邮件发送、批量修改等业务写操作。

网页授权需要站点已部署配套的授权页面和后端接口。返回 404 时说明尚未部署，不能自动改用密码登录或读取浏览器凭据。已有连接设置不会被默认地址覆盖。

已有测试站或其他站点配置时，可用独立配置切换到 API 站点。之后的业务命令也使用 `--profile api`。

```sh
python3 "$LFX" --profile api configure
python3 "$LFX" --profile api login
```

其他站点可以用 `--base-url` 指定接口地址。本机模式需要先启动连接本机后端的开发网页。

```sh
python3 "$LFX" --profile production configure --base-url https://web.laifaxin.com/api
python3 "$LFX" --profile internal configure --base-url https://test.laifa.vip/api
python3 "$LFX" --profile local configure --base-url http://localhost:5175/api
```

使用对应的配置名运行 `login`。每个站点管理自身签发的授权。持有旧版无域名凭据的用户，升级后需在对应站点重新登录授权。

- 兼容方式仅在用户明确选择时使用：`login --method password` 的密码登录沿用 `/user/login` 的 `username/password/host`；密码在交互式终端内隐藏输入，不放在参数、聊天或请求文件中。
- 邮箱验证码登录：`python3 "$LFX" login --method email`。会发送一次验证码，用户在终端输入后登录。短信/微信/滑块等其他登录流程可在 Web 完成后使用用户主动导出的会话；不要绕过人机验证。
- Web 认证与 host 相关，兼容的密码/验证码登录可能影响同 host 的旧会话；默认网页授权的 Skill 凭据独立保存，可单独撤销。
- 配置存在用户本机 `~/.config/laifaxin-skill/default.json`，以 600 权限保存；不包含密码。`--profile 名称` 可隔离多个连接，放在子命令之前。`LAIFAXIN_CONFIG_DIR` 可指定本机配置目录。
- 不把凭据配置或带私密数据的临时请求文件提交、加入 Skill 压缩包或发送给其他人。

## 已有 Web 会话

用户主动提供的本机会话文件支持两种格式：

```json
{"accesstoken":"由用户本机保存的凭据","orgId":"工作区 ID"}
```

或 Web 主动导出的 `{"state":{"token":"…","orgId":"…"}}`。脚本不会读取浏览器数据库、Cookie 或 localStorage。

```sh
python3 "$LFX" import-session --file /用户本机/私密会话.json
```

先读取 `/account/current` 验证，再保存；仅输出连接状态。使用后由用户删除额外导出文件，保留私密配置即可。不要把示例占位字符串当真凭据。

## 工作区与会话失效

```sh
python3 "$LFX" workspaces
python3 "$LFX" workspace 真实的uid
python3 "$LFX" status
python3 "$LFX" logout
```

工作区列表含个人账号和企业，使用 `uid` 与 `isOrg` 识别，`status` 应为 `ok`。网页授权绑定一个工作区；列表只返回已授权工作区。需要切换时重新 `login`，由用户在网页选择目标工作区。`workspace UID` 不能突破授权范围。兼容密码/验证码会话才可直接切换已加入的工作区；切换后重新查询业务对象，不复用旧工作区的 ID。

网页授权允许现有客户、邮件、营销、设置、企业、费用和报表业务接口，但不允许修改账号密码、绑定身份或管理授权。创建/加入其他企业请在网页完成；个人资料修改、合伙人和提现等账号级操作需授权个人工作区。接口目录包含 Web 的全部契约，不等于当前授权可调用全部路径。部分旧接口尚未完成资源归属校验，网页授权会拒绝调用；收到这类拒绝时说明限制并引导用户回网页操作，不改用其他凭据绕过。

HTTP 401、403 或 HTTP 203 且 `success:false` 时停止当前操作，保留后端提示；重新登录或由企业管理员调整真实权限。不要不断尝试其他 uid 或绕过权限。

## 请求和运行结果

```sh
python3 "$LFX" catalog contacts
python3 "$LFX" describe /contacts/contacts/show
python3 "$LFX" source packages/api-client/src/crm.ts
python3 "$LFX" request /contacts/contacts/show --body-file /本机/查询.json
python3 "$LFX" request /contacts/contacts/show --body-file /本机/查询.json --execute
```

`request` 默认只预览；加 `--execute` 才联网。此开关是防误运行机制，不代替用户授权，也不要求对已授权操作再问一次。请求体使用文件或 `--body-file -` 从 stdin 读取，避免 shell 拼接业务文本。

客户端不剥响应信封；某些企业接口的 `total/current` 与 `data` 同级。未知响应、业务失败保留后端错误数据并返回非零退出码。凭据字段在输出中遮盖。发信状态中 `state:pending` 表示仍在处理，不能说已发送成功。

本包以 Python 标准库为执行基础。只支持上传文件、不提供本机脚本运行或网络访问的聊天宿主，不能仅靠安装本包直接调用接口；需要该宿主的连接器或另行提供 MCP 服务。
