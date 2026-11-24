# 来发信业务流程索引

先按任务选模块，用 `catalog`/`describe` 定位，再只读相关 `contracts/` 文件。下表路径是随包契约快照中的路径，不要求安装者拥有源码仓库。快照只作请求规则参考，不直接执行其中的 TypeScript。

| 用户任务 | catalog 搜索词 | 关键契约文件（位于 contracts/） |
| --- | --- | --- |
| AI 数据库、企业检索、推演方案、产品匹配 | refine | apps/web/src/api/refine.ts |
| 搜公司域名/名称、领英公司、批量搜索、客户保存记录 | prospect、linkedin、clues | apps/web/src/api/prospect.ts |
| 公司资料、邮箱、AI 评分、相似公司 | company-detail、rating | apps/web/src/api/company-detail.ts、rating.ts |
| 谷歌地图数据、标签、搜索邮箱、导出 | clouds、map-data | apps/web/src/api/clouds.ts、crm-export.ts |
| 联系人、公司、视图、批量操作、回收站 | contacts、views、recycle | packages/api-client/src/crm.ts、crm-contact.ts、crm-company.ts、crm-recycle.ts；packages/core/src/crm.ts |
| 跟进记录、待办任务、客户动态 | record、contact-history | packages/api-client/src/follow.ts、tasks.ts；apps/web/src/api/contact-history.ts |
| 客户导入和导出 | import、export | apps/web/src/api/crm-import.ts、crm-export.ts |
| 收件箱、邮件详情、草稿、回复、转发、发送、定时、追踪、翻译 | mails、mail | apps/web/src/api/mail.ts；packages/core/src/mail.ts、mail-address.ts、mail-reply.ts |
| 邮件群发、跟进计划、营销追踪和报告 | marketing、sequences、tasks/mass | apps/web/src/api/marketing.ts |
| 标签、字段、模板、短语、签名、附件库、产品档案、黑名单 | tags、fields、content、attachment、products、blacklist | apps/web/src/api/tags.ts、content.ts、attachment-library.ts、products.ts、blacklist.ts；packages/api-client/src/fields.ts |
| 邮箱账号、系统发信账号、发送时段 | sending、mailbox、schedule | apps/web/src/api/sending.ts |
| 企业、成员、角色、部门、配额、邀请 | enterprise | apps/web/src/api/enterprise*.ts；packages/api-client/src/workspace.ts、permissions.ts |
| 账户、个人资料、密码/绑定等安全设置 | account、personal、user | packages/api-client/src/account.ts、personal.ts、auth.ts；packages/core/src/auth.ts |
| 余额、充值订单、消费、优惠、福利、邀请奖励 | expenses、partner、growth | apps/web/src/api/expenses.ts、topbar.ts、partner.ts、growth-tasks.ts |
| 通知、我的后台任务、统计分析 | notifications、operation、reports | apps/web/src/api/notifications.ts、topbar.ts、reports.ts |
| 图片、附件、导入文件 | file | apps/web/src/api/upload.ts；packages/core/src/upload.ts |

## 搜客户 → 保存 → 联系人

1. 明确目标国家、行业、公司关键词、数量，选择 AI 数据库、领英或域名搜索接口。筛选字段和操作符依对应模块，不把高级筛选表达式混用。
2. 搜索响应出现 `waiting` 时先查任务；额度用尽时保留 `dailyUsedUp/monthlyUsedUp`，不要自行开启额外扣点。
3. 联系人保存路径取决于来源。参阅 `packages/core/src/crm.ts` 的 `SAVE_ENDPOINT` 和 `SaveContactsForm/Context`，不要把企业详情主键当 CRM 公司 `c_id`。
4. 保存返回后台 ID 后查询结果，报告实际保存数量而非计划数量。领英 `relation:gte` 表示总数下限，最多可浏览 10,000 家，不能承诺导出全部匹配。

## 列表与批量管理

- AI 数据库 `/refine/company-list` 的 `pageSize` 为 1–10，`current` 为 1–10000 的整数；脚本在发送前拦截超出范围或类型不符的已传入参数。其他分页接口的 `pageSize` 为 1–100。从 `current: 1` 开始，按用户需要的数量逐页读取。
- 查询最新一条客户保存记录时，向 `/clues/company-save-list` 传 `{"current":1,"pageSize":1,"filter":{"status":"total"},"sort":{"create_time":-1}}`。若站点返回 422，保留后端提示的字段和范围。
- 标签、字段、负责人和对象 ID 都从当前工作区查询。字段编辑遵循该字段 dataIndex、类型和值域。
- CRM `viewId:'all'`，视图作用由 filters 表达；范围参数按 `baseParams` 生成。邮件、跟进计划、地图数据分别读其范围构造函数。
- 企业成员分页的 `data` 是数组、`total/current` 在信封顶层，不能用当前页长度假装全量。
- 批量范围若为全部匹配，报告筛选摘要和数量；未确认范围时先预览，不静默扩大。

## 邮件与营销

### 单封发送/定时

1. 查询邮箱账号、系统发信账号和可用发件人，选出真实 `maid/sender`。不要把发件邮箱地址直接当 maid；系统通道可能扣通用点数。
2. 草拟或读取完整正文，核对收件人/抄送/密送、主题、附件和发送时间。`mail-open` 会标记已读；如只要列表摘要就不打开。
3. HTML 只存在 `downloadUrl` 时，邮件完整正文可能在 EML 中，不能把列表 text 摘要当完整正文。只下载用户要求阅读的邮件文件，下载时不携带来发信认证头、不自动加载邮件中的外部追踪图片；可用 Python 标准库 email 解析 EML。
4. 图片和附件先运行 `upload`，等 `/file/save-log` 成功。附件引用使用返回的 URL/name/size；库附件使用选项中的 `value` 作为 `attIds`。
5. 按 `apps/web/src/api/mail.ts` 的 `composeBody` 构造请求。`to/cc/bcc` 是逗号分隔字符串；`attNormal:true`；即时发送 `sendAtOnce:true`，定时则为 false 且带未来 90 天内的毫秒 `timeStart`。向用户展示有时区的具体日期时间；不要把秒当毫秒。
6. 有发送授权后调用 `/mails/sendmail-add`。取得 sendId 后运行 `send-status SEND_ID --wait 30`。`finished` 且核对总数后才报告完成；失败逐项展示 `to` 和后端 `message`，不重发已成功的收件人。

**单发直发配方（直接设置收件人、主题、正文）**：单发与普通写信共用 `POST /mails/sendmail-add`，无需先建模板或任务。**适用范围**：以下结论在「仅系统账号、无绑定邮箱」的工作区实测；绑定自有邮箱后，`maid` 与 `sender` 以该账号在 `/mails/accounts-list` 的行与已发送记录为准（自有通道未逐项实测）。最小请求体（逐字段省略验证过，六个字段缺一不可）：

```json
{
  "maid": "system",
  "sender": "1804106008.z7pvxh",
  "to": "<zhangsan@example.com>",
  "subject": "主题",
  "html": "<p>正文 HTML</p>",
  "sendAtOnce": true
}
```

- `maid` 取自 `/mails/accounts-list` 的账号行（系统账号为 `system`）；`sendAtOnce` **必填**，缺了后端会明确报错「需要明确 sendAtOnce」。其余字段（`single`、`track`、`senderName`、`replyTo`、`attNormal`、`attIds`、`attachments` 等）都可省略；`attNormal` 是网页端恒发 `true` 的固定字段，省略不影响发送（带附件时同样实测可省）。
- **发件人标识 `sender`（实测）**：必须用**完整标识**（形如 `1804106008.z7pvxh`），只填 `/mailbox/sender-items` 里的裸 `name`（如 `z7pvxh`）会被拒。纯 API 获取法：查已发送记录——`POST /mails/mails-list`，filter 传 `{maid, parent:"/", keyword:""}`，记录里的 `sender` 字段就是完整标识，取到后缓存复用；记录里有多个不同 `sender` 时，按 `/mailbox/sender-items` 里目标发件人的 `name` 后缀匹配挑选，别随便取第一条；同后缀仍有多个时取时间最新的一条，批量使用前先小样验证一封。另注意：`sender-items` 的行里只有 `name/fromName/domain/_id`，不含完整标识（实测读回），别指望从它拼出来。工作区还没有任何已发送记录时，`mails-list` 也读不到完整标识：先请用户经网页端发一封任意邮件（测试收件人用非国内邮箱，见下条），再从已发送记录读回完整标识并缓存；或从网页端写信窗的发件人下拉取（括号前那串）。`sender-items` 永远给不出完整标识，不要在它上面耗时间。
- **报错对照（实测）**：「发送对象地址格式错误」＝收件人没按 `<邮箱>` 格式写；「需要明确 sendAtOnce」＝漏传 `sendAtOnce`。「该邮箱无法发送，请联系客服解锁发送」**一词三义，按顺序排查**：① **收件人是中国地区邮箱**（QQ、163、126、新浪等）——平台配合反诈的禁发规则，系统通道与平台代发都禁（实测对照：同账号同通道发 email@zhijixinxi.com 成功、发 QQ 邮箱立刻回此错）；确需向国内邮箱发送的，联系官方客服完成认证、申请加入白名单后再发；**测试发送的收件人只能用非国内邮箱，默认 email@zhijixinxi.com**。② `sender` 用了裸 `name` 而不是完整标识（实测对照：同账号裸 `name` 必报此错、换完整标识即发送成功）。③ 发件身份被停用。排查顺序：先查收件人是不是国内邮箱 → 再核对发件标识 → 最后才查账号与身份状态；**不许把这句报错说成「通道被锁」或「账号被锁」**。
- **收件人格式（源码＋实测）**：`to/cc/bcc` 的每个地址必须是 `<邮箱>` 或 `显示名 <邮箱>` 形式，多人用英文逗号拼接；只写裸邮箱会被后端拒绝。网页端「快速发邮件」用的就是 `<邮箱>` 形式。`cc` 实测可正常投递；`bcc` 同格式（未单独实测投递）。
- `single`（实测）：`true` 为分别发送（每个收件人单独一封、互不可见，发送状态的总数＝收件人数）；`false` 为群发（一封同达所有收件人，收件端 To 头里能看到全部收件人，发送状态总数＝1）。**省略 `single` 时按群发处理**（实测），多人发送务必显式传 `true`；给单个收件人直发时同样用 `true`。
- **正文格式（实测）**：`html` 字段传 HTML，与网页编辑器产出一致——段落用 `<p>`、换行用 `<br>`、加粗用 `<strong>`；只传纯文本（带 \n）会连成一段。`text` 纯文本版可选（网页端从 HTML 自动提取；实测只传 `html` 时收件端段落完好）。
- **追踪（实测）**：`track: true` 会在正文末尾埋一个隐藏追踪像素（收件端 HTML 里可见 `0×0` 的 img，指向发信域名下的 `/center/r/<令牌>.png`），用于统计打开；`false` 则不埋。打开数据用 `/mails/track-info` 查，参数名是 `sid`，取值是已发送记录里的 `ssid` 字段——它就是像素网址里那串令牌（实测对应）；发送返回的 sendId 是另一个标识（发送会话号，与记录 `_id` 也不同），别混用。接口本身实测可调通，但真实打开事件是否回录未端到端验通（测试环境拉不到像素图），查到空数组不等于没人打开，先这样用、有实测进展再更新本条。
- **定时（实测）**：`sendAtOnce: false` ＋ `timeStart`（毫秒时间戳）预约发送；提交成功返回的是邮件 `id`（不是 sendId），到点自动发出（实测准时）。改期 `/mails/change-timer`（`{id, timeStart}`）、取消 `/mails/cancel-timer`（`{id}`）均实测可调通；取消是幂等的（重复取消不报错），所以取消后必须回查确认：用 `mails-list` 找到 `_id` 与预约返回 `id` 完全一致的那条记录（记录编号与预约 id 是同一个，实测对照），它落在 `Drafts` 箱且 `timeStart` 为 null，就是取消生效。`timeStart` 必须是未来 90 天内的毫秒时间戳——缺失或超限时后端明确报错「定时发送需要未来 90 天内的毫秒时间戳 timeStart」（报错原文实证）。定时邮件到点发出后，打开数据同样走 `track-info`，`sid` 取已发送记录的 `ssid`。
- **发件人显示名称 `senderName`（可选，后端已支持）**：调用 `/mails/sendmail-add` 时可通过 `senderName` 为本封邮件临时指定发件人显示名称（注意参数名是 `senderName`，不是 `fromName` 或 `sendName`）。校验规则：字符串，trim 后最长 64 字符，不能包含换行或空字符（`\r`/`\n`/`\0`）；留空或省略时回退到账号默认名称。立即发送与定时发送均支持；定时邮件重新排期（带 `id`）时若未传或传空字符串会清空此前保存的 `senderName`。双通道表现：系统通道用 `senderName || 账号默认 fromName`（不改发件账号与域名）；自有 SMTP 通道覆盖 `From`、默认 `Reply-To` 与 `Disposition-Notification-To`（回退顺序：`senderName` → 账号 `mail_name` → 发件邮箱前缀）。如需修改账号级默认发件人名称，仍在网页端「设置 → 系统账号」或 `/mailbox/sender-save` 传 `{id, fromName}` 维护（`name` 与 `domain` 创建后不可改）。
- **自定义回信邮箱 `replyTo`（可选，后端已支持）**：调用 `/mails/sendmail-add` 时可通过 `replyTo` 为本封邮件指定回信地址。格式与校验：单个地址字符串，支持纯邮箱（`reply@example.com`）、尖括号邮箱（`<reply@example.com>`）、`显示名 <邮箱>` 或 `"显示名" <邮箱>`；trim 后最长 320 字符（显示名最长 128 字符，未加引号的显示名不能含 `< > " , ; :`），不能包含换行或空字符，**不支持逗号分隔多个地址**（格式错误时后端返回「回信邮箱格式错误」）；留空或省略时使用默认回信地址。立即发送、定时发送（重排期带 `id` 且未传或传空时会清空原值）与 `single: true` 分别发送（逐封保留）均支持。双通道表现：系统通道下有显示名时格式化为 `"显示名" <邮箱>`、无显示名时传纯邮箱、留空不传；自有 SMTP 通道下带显式显示名时保留该显示名，仅传邮箱或 `<邮箱>` 时继承本封邮件的发件显示名（`senderName` 或账号默认名），同时 `From` 与已读回执头仍保持原发件人。
- **附件（实测）**：先 `upload --kind att <文件>` 拿到 `url/name/size`，再填入 `attachments`（`attIds` 是附件库引用，两者别混）；收件端可正常收到附件。
- **系统通道注意**：系统通道从公共轮换域名发出；实测样本中系统通道直发 Gmail 的邮件均进了垃圾箱（样本有限），正式给客户发送建议绑定自有邮箱或域名。`readReceipt`（已读回执）与 `priority`（优先级，`"1"|"2"|"3"`）在系统通道下不生效——网页端拼装请求时即剔除（源码口径），API 直发时传了也别指望效果；源码显示网页端仅在非系统通道才拼入这两个字段，自有通道下是否真生效未实测。
7. 定时提交成功只表示安排任务，不表示邮件已经送达。取消定时后重新查询列表核对，不能仅凭成功信封保证拦住已开始发送的邮件。

回复/转发使用原邮件真实 ID 和 `replyId/forwardId`，按回复语义确定 To/CC，不能把所有原地址盲目加入。保存草稿走 `/mails/mail-save`，与发送分离；新建有 ID，更新可能无 data。

### 邮件移动与删除

`mail-move` 只更新 boxName，不改 maid 或 parent，因此只移动到同一账号、同层的现有目录；回收站使用删除接口。删除普通目录邮件与彻底删除回收站邮件是不同动作。移动和取消定时存在恒成功信封，必须通过列表读回核对，不要调用 mail-open 额外改变已读状态。

### 群发和智能跟进

先查目标人群、发信通道、模板、发送时段和额度，准备任务参数供核对。`/tasks/mass/add` 携带 `sendAtOnce/timeStart`，应作为提交发送任务处理，不能当作纯草稿接口；用户只要求“准备群发、先不要发”时保存本机方案或邮件模板，不提交这个接口。已有任务启动和跟进计划启用也属于发送授权。群发 `limitNum:0` 表示不限量，不是发送零封；限定数量必须设置真实上限。重发已有任务读取 `/tasks/mass-info` 的输入，而不是统计用的 `/marketing/task-details`。往计划加入指定联系人用 `/contacts/contacts/sequence-add`，按视图/标签整批加入才用 `/sequences/contact-add`；给正在运行的计划加人也可能触发发送，先核对其启用状态。群发一律走接口，不要引导用户去点网页端群发向导——向导在窄窗口（≤1100px）下「保存」按钮不显示（已报平台），用户照着点会卡住。群发的收件人同样受禁发规则约束：中国地区邮箱（QQ、163、126、新浪等）发不出去，建任务前先剔除或单独分组，并向用户说明原因与白名单申请路径。

## 上传、导入、导出和任务

上传脚本采用与 Web 一致的三步：获取 STS → HTTPS 直传 OSS → 登记文件。`img` 用正文图片，`att` 用附件，`store` 用导入；单文件小于 10MB。任何一步失败都保留失败状态，不继续发信。

导入先上传、调用预览，再确认工作表、从 1 开始的表头行、列到字段映射和新增/更新策略，最后提交并查询进度。联系人和公司使用不同的导入路径和匹配字段；按 `crm-import.ts` 构造。

导出提交后查询 `/contacts/export-status`：1 完成，2 额度不足，3 无数据，9 失败，四种均停止轮询。只有完成且存在有效下载地址才交付下载结果。

通用后台任务查询 `/operation/backend-task-status` 需要原始 `type` 和 `id`，`backendId` 不足以猜出 type。名单接口只返回当前运行任务；列表中消失不是成功证据。参考领域创建流程取得 type，保留任务 ID，轮询最多每 30 秒一次；finished/aborted/paused/poor 时停止当前等待并说明状态。

同步等待应有边界；单次等待 30–60 秒后仍未完成时向用户说明处理中。继续当前任务可后续查询同一任务，不为等待结果创建新的任务或自动化计划。

## 企业、账户和费用

成员/部门/角色/配额管理以当前权限为准，读契约里的 `action`，不得根据接口尾缀推断只读。退出企业接口名为 `organize-exist`；个人工作区不是企业。

充值/订单/转账/提现/发票等仅按用户明确指令操作。生成支付链接或二维码不代表付款完成，支付结果从订单接口核对；第三方付款页交给用户完成。权限、账单和后端额度以实时查询为准，不把旧缓存值当余额承诺。
