/**
 * 收件箱。平台无关的邮件账号、目录、列表、详情契约与纯函数。
 * 写操作、发送、翻译和追踪适配继续由 Web 管理。
 *
 * 几处必须记住的口径:
 *
 * **1. 筛选条件是三段互斥链,不是三个并列条件。** 后端 `getFilterQuery`:
 * ```
 * if (keyword)   → 正则搜 to/from/subject/text,**完全忽略 tagsId 和 parent**
 * else if (maid) → 展开该目录及子目录
 * else if (tagsId) → 按分类查,且**强制 boxName = 'INBOX'**
 * ```
 * 界面上必须让用户看得出「搜索时分类不生效」「按分类看时只看收件箱」。
 *
 * **2. 归属过滤只在 `maid === 'system'` 时才生效**(后端 `:662`)。
 * 选了具体账号还传 owners,后端直接忽略 —— 不是前端漏传。
 *
 * **3. `mail-open` 邮件不存在时回 `{ success: true, data: null }`**,
 * 不是 success:false。取不到必须当「已删除」处理,不能让 `.attachments` 崩掉。
 *
 * **4. 大量写接口恒回 `success: true`**(mail-drop / mark-seen / mail-move …),
 * 不能拿它判断「真的做成了」。打开未读邮件的接口也会同步标为已读。
 */

/* ---------- 账号与目录树 ---------- */

/**
 * 目录/账号树的一个节点。账号层与目录层是同一个形状,靠 `parent === '/'` 区分。
 *
 * `maid === 'system'` 表示来发信平台账号。普通目录查询仍带这个账号，
 * 搜索时由 mailListBody 省略它，以匹配 Web 的跨邮箱搜索口径。
 */
export interface MailNode {
  name: string;
  maid: string;
  /** 账号层是 `'/'`;目录层是父目录的 boxName */
  parent: string;
  /** 账号层是邮箱地址,目录层是 IMAP 的 box 名(INBOX / Sent / …) */
  boxName: string;
  /**
   * 账号层的收信连接状态。**是字符串,不是数字** ——
   * `entity/mailbox/mailbox_account.ts:55` 写着 `re_status: string; // success, failed, unkown`
   * (后端把 unknown 拼错了,照抄),下发时是 `status: re_status`
   * (`service/mail.ts:855`)。
   *
   * ⚠️ 前端原来判的是 `status === 0`,那是**永远不成立**的 ——
   * 邮箱密码改了、IMAP 连不上,侧栏一个提示都没有,用户只会觉得
   * 「这个邮箱怎么不来新邮件了」。
   */
  status?: string;
  error?: string;
  total?: number;
  unseen?: number;
  children?: MailNode[] | null;
}

/** 这个邮箱是不是连不上。`unkown` 的拼写是后端的,别改成 unknown */
export const isAccountBroken = (n: { status?: string } | undefined) => n?.status === 'failed';

/**
 * IMAP 目录名归一化,照抄后端 `exMailBoxname`。
 * 后端已经归一过一轮,但账号自建的目录会原样返回,前端再兜一次口径才一致。
 *
 * ⚠️ 这里**只认出是哪个系统目录,不出文案** —— 原来直接返回中文字面量,
 * 于是英文界面下整棵目录树还是「收件箱 / 已发送 / 草稿箱」。
 * 文案交给调用方走 i18n(`mail:box.*`),认不出来的自建目录返回 null,
 * 由调用方回落到后端给的原名。
 */
export const SYSTEM_BOXES = ['inbox', 'sent', 'drafts', 'junk', 'deleted'] as const;
export type SystemBox = (typeof SYSTEM_BOXES)[number];

export function systemBoxOf(boxName: string): SystemBox | null {
  const b = (boxName ?? '').trim().toLowerCase();
  if (b === 'inbox' || b === '收件箱') return 'inbox';
  if (b === 'outbox' || b.startsWith('sent')) return 'sent';
  if (b === 'drafts' || b === 'draft' || b === '草稿箱') return 'drafts';
  if (['junk', 'spam', '垃圾邮件'].includes(b)) return 'junk';
  if (
    b.startsWith('deleted') ||
    ['trash', 'bin', '已删除', '已删除邮件', '垃圾箱', '回收站', '废纸篓'].includes(b)
  )
    return 'deleted';
  return null;
}

/** 这几个判断在详情页决定按钮可见性,先放在这一层,免得下一批各写一份 */
export const isTrashBox = (b: string) => systemBoxOf(b) === 'deleted';
export const isDraftsBox = (b: string) => systemBoxOf(b) === 'drafts';
export const isSpamBox = (b: string) => systemBoxOf(b) === 'junk';

/** 在树里按账号、目录名和父路径找节点。删除走「回收站」还是「彻底删」要靠它现算 */
export function findNode(
  nodes: readonly MailNode[],
  maid: string,
  boxName: string,
  parent?: string,
): MailNode | undefined {
  for (const n of nodes) {
    if (
      n.maid === maid &&
      n.boxName === boxName &&
      (parent === undefined || (n.parent ?? '') === parent)
    )
      return n;
    const hit = n.children ? findNode(n.children, maid, boxName, parent) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

/* ---------- 分类 ---------- */

export interface MailTag {
  /** 主键是 `id`,不是 `_id` */
  id: string;
  name: string;
  color?: string;
  builtin?: boolean;
  folder?: boolean;
}

/**
 * 内置分类固定 5 个,**顺序是硬契约** —— 后端在数组头硬拼这 5 条,
 * 前端靠「下标 ≥ 5」判断能不能改名删除。别按 id 白名单判,后端加内置分类时会漏。
 */
export const BUILTIN_TAG_COUNT = 5;
export const isCustomTag = (index: number) => index >= BUILTIN_TAG_COUNT;

/* ---------- 列表 ---------- */

/** 邮件状态。0 未读 / 1 已读 / 2 已回复 / 3 发送成功 / 4 退信 / 5 已转发 / 9 定时 */
export const MAIL_STATUS = {
  unread: 0,
  read: 1,
  replied: 2,
  sent: 3,
  bounced: 4,
  forwarded: 5,
  scheduled: 9,
} as const;

export type ReadFilter = 'all' | 'unread' | 'readed';

export type MailScopeOption = 'current' | 'all';
export interface MailScope {
  [k: string]: unknown;
  ids: string[];
  filter: Record<string, unknown>;
  owners: string[];
  selectOption: MailScopeOption;
}

/** Draft and scheduled status also controls sending; never overwrite it as a read flag. */
export function canMarkMailRead(mail: MailRow | undefined): mail is MailRow {
  return (
    !!mail &&
    !!mail._id &&
    !!mail.maid &&
    !!mail.boxName &&
    !isDraftsBox(mail.boxName) &&
    !(mail.timeStart && mail.timeStart > 0) &&
    [0, 1, 2, 3, 4, 5].includes(mail.status ?? -1)
  );
}

/** Soft deletion only. Scheduled mail requires a separate cancellation workflow. */
export function canTrashMail(mail: MailRow | undefined): mail is MailRow {
  return (
    !!mail &&
    !!mail._id &&
    !!mail.maid &&
    !!mail.boxName &&
    !isTrashBox(mail.boxName) &&
    !(mail.timeStart && mail.timeStart > 0) &&
    [0, 1, 2, 3, 4, 5].includes(mail.status ?? -1)
  );
}

/** Restoration preserves the existing read status and only applies to Deleted mail. */
export function canRestoreMail(mail: MailRow | undefined): mail is MailRow {
  return canMarkMailRead(mail) && isTrashBox(mail.boxName ?? '');
}

/**
 * 附件。**同一个字段有三套名字**,取决于这封信是怎么来的:
 *
 * | 来路 | 文件名 | 大小 | 地址 |
 * |---|---|---|---|
 * | 收到的信(`mail_attachment` 实体) | `filename` | `size` | 只有 `savePath`,**没有 url** |
 * | 自己发的(`exchangeAttachments`) | `filename` | `filesize` | `url` |
 * | mailbox 附件表那一支 | `filename` | `fileSize` / `size` | `url` |
 *
 * ⚠️ **三条路里都没有 `name`。** 前端原来一路读 `att.name`,后果不只是
 * 附件名显示成空:`extOf('')` 得空串,于是
 * `FORBID_TYPES = ['html','bat','exe',…]` 这道拦截**永远不命中** ——
 * 收到一封带 invoice.html 的钓鱼邮件,那颗按钮和普通附件毫无区别。
 * 收到的信连 `url` 都没有,下载压根点不动。
 *
 * 所以读这三个字段一律走下面三个取值函数,不要在组件里自己解构。
 */
export interface MailAttachment {
  contentId?: string;
  cid?: string;
  filename?: string;
  name?: string;
  size?: number;
  filesize?: number;
  fileSize?: number;
  url?: string;
  savePath?: string;
  partId?: string;
}

export const attName = (a: MailAttachment): string => a.filename ?? a.name ?? '';
export const attSize = (a: MailAttachment): number => a.size ?? a.filesize ?? a.fileSize ?? 0;
/**
 * 附件直链。收到的信只给 `savePath`,拼不出绝对地址的话就是拿不到 ——
 * 返回空串让调用方显式处理(禁用下载按钮),而不是给一个点了没反应的按钮。
 */
export const attUrl = (a: MailAttachment): string => a.url ?? '';

export interface MailRow {
  _id: string;
  parent?: string;
  subject?: string;
  from?: string;
  to?: string;
  /** 后端 join 出来的展示名 */
  fromName?: string;
  text?: string;
  timestamp?: number;
  status?: number;
  /** 定时发送的时间点。有值 = 这封信在草稿箱里等着到点自己发 */
  timeStart?: number;
  size?: number;
  tags?: string[];
  attachments?: MailAttachment[];
  attIds?: string[];
  /** Server flag for messages known to contain attachments. */
  attach?: boolean;
  /** OSS 上 body.eml 的直链。html 为空时靠它兜底 */
  downloadUrl?: string;
  /** 页内邻居,后端给的,用来做上一封/下一封 */
  prevId?: string;
  nextId?: string;
  boxName?: string;
  maid?: string;
  userid?: string;
  ssid?: string;
}

export interface MailListQuery {
  current: number;
  pageSize: number;
  maid: string;
  parent: string;
  boxName: string;
  keyword: string;
  tagsId: string;
  read: ReadFilter;
  owners: string[];
  /** Optional stable pagination order; omitted by existing Web callers. */
  sort?: { timestamp: -1; _id: -1 };
}

export interface MailListResult {
  list: MailRow[];
  total: number;
  unseen: number;
  /** 附件/正文的 OSS 前缀,后端每次列表都回 */
  storeUrl?: string;
  trackUrl?: string;
}

export const MAIL_PAGE_SIZE = 20;

/**
 * 列表请求体。**三段互斥链在这里就体现出来**:
 * - 有关键词时不发 tagsId / parent(后端也会忽略,但发出去会让人以为生效了)
 * - 归属只在聚合视图(maid==='system')下发
 * - `read` 为 all 时 **status 这个键整个不出现**,不是发 undefined
 */
/**
 * 转义正则元字符。
 *
 * ⚠️ **后端把 keyword 直接塞进 `new RegExp(keyword, 'i')`**
 * (`service/mail.ts:687`,收件人补全那个接口同样),自己不转义。
 * 于是用户搜一个 `C++`、`+86`、或者只打了半个 `(`,后端就抛
 * SyntaxError: Nothing to repeat —— 整个列表接口 500,页面一片空。
 * 外贸场景里 `C++`、`(MOQ)`、`+86` 都是很正常的搜索词。
 *
 * 转义之后是按字面量搜,这也正是用户的预期:在邮件里搜 `C++` 就该找 `C++`,
 * 没人指望在收件箱里写正则。
 */
export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mailListBody(q: MailListQuery) {
  const keyword = q.keyword.trim();
  const filter: Record<string, unknown> = { keyword: escapeRegExp(keyword) };
  if (keyword) {
    // 搜索是全局的:带上账号但不带目录/分类,免得看起来像「在这个目录里搜」
    if (q.maid && q.maid !== 'system') filter.maid = q.maid;
  } else if (q.tagsId) {
    filter.tagsId = q.tagsId;
  } else {
    filter.maid = q.maid;
    filter.parent = q.parent;
    filter.boxName = q.boxName;
  }
  if (q.read !== 'all') filter.status = q.read === 'unread' ? 0 : 1;
  return {
    current: q.current,
    pageSize: q.pageSize,
    sort: q.sort ?? {},
    filter,
    // 归属过滤后端只在聚合视图下认
    owners: q.maid === 'system' || (!keyword && q.tagsId) ? q.owners : [],
  };
}

/* ---------- 详情 ---------- */

export interface MailDetail extends MailRow {
  html?: string;
  cc?: string;
  bcc?: string;
  sender?: string;
  single?: boolean;
  track?: boolean;
  readReceipt?: boolean;
  priority?: '1' | '2' | '3' | null;
  replyId?: string;
  forwardId?: string;
  oriStatus?: number;
  /**
   * 退信原因。**是对象,不是字符串** —— 后端 `service/mail.ts:1418` 写死
   * `let error = {}`,只有 `oriStatus === 4`(退信)才去 `logSendWebhookModel`
   * 捞一条真记录盖上去,捞不到还会是 `null`。
   *
   * ⚠️ 所以三种值都可能:`{}`(绝大多数信)、webhook 记录、`null`。
   * 空对象是 truthy —— 当字符串直接渲染的话,**打开任何一封正常邮件都会
   * 抛 "Objects are not valid as a React child"**,而路由没配 errorComponent,
   * 整个收件箱会被错误页替换。判真假一律走 {@link bounceReason}。
   */
  error?: MailBounce | null;
  /**
   * AI 分类结论(给人看的那一份)。
   *
   * ⚠️ **这是上游「来发信云」透传下来的裸对象,这个后端一行都没写过它。**
   * entity 里就一个 `object`(Mixed / Severity.ALLOW),没有 DTO、没有校验、
   * category 也没有枚举 —— 上游随时可以多给少给。所以每个字段都当可选,
   * category 当任意字符串,认不出的走兜底样式。
   *
   * 形状的唯一书面记录是老前端组件里的本地 interface
   * (`sections/mail/components/mail-sorting-header.tsx:26`)。
   *
   * ⚠️ 与 {@link isAlert} **不是一回事**:那个是「这个发件地址最近在批量发信」
   * 的行为风控,跟 AI 判断无关,两条提示要分开显示。
   */
  sorting?: MailSorting | null;
  /**
   * 行为风控:这个发件地址近期是不是在批量发信。
   * 现算于 mail-open(`service/mail.ts:1425`),只有聚合视图、
   * 且已经被分类过的邮件才会去问上游,拿回来就一个布尔。
   */
  isAlert?: boolean;
  fromTags?: string[];
  toTags?: string[];
}

/**
 * AI 分类结论。字段全可选 —— 后端不校验,上游给什么是什么。
 */
export interface MailSorting {
  /** `Risk` / `Inquiry` / `Ad` / `System` / `Reject`,但**不保证**是这五个之一 */
  category?: string;
  /** 给用户看的一句话解释 */
  user_explanation?: string;
  ui_alerts?: string[];
  risk_details?: { risk_type?: string; risk_reason?: string };
  action_suggestion?: string;
}

/** 认得出的分类。认不出的一律走兜底,不要 crash 也不要把英文原样丢给用户 */
export const SORTING_CATEGORIES = ['risk', 'inquiry', 'ad', 'system', 'reject'] as const;
export type SortingCategory = (typeof SORTING_CATEGORIES)[number];

export const sortingCategoryOf = (s: MailSorting | null | undefined): SortingCategory | null => {
  const c = (s?.category ?? '').trim().toLowerCase();
  return (SORTING_CATEGORIES as readonly string[]).includes(c) ? (c as SortingCategory) : null;
};

/**
 * 分类横幅该不该显示。
 *
 * 照老前端的判据:**分类结论要和 tags 对得上**才显示
 * (`mail-details.tsx:381` 的 `tags.includes(sorting.category.toLowerCase())`)。
 * 对不上说明这封信的标签被人改过 / 反馈过,横幅上那个结论已经不作数了。
 */
export function shouldShowSorting(d: MailDetail | null | undefined): boolean {
  const cat = sortingCategoryOf(d?.sorting);
  return !!cat && (d?.tags ?? []).some((t) => t.toLowerCase() === cat);
}

/** 退信 webhook 记录。字段照 `entity/log/send_webhook.ts` */
export interface MailBounce {
  recipient?: string;
  /** 投递事件,如 bounce / dropped */
  event?: string;
  message?: string;
  log_time?: number;
}

/**
 * 退信原因文案。`{}` 和 `null` 都当「没有退信」——
 * 只有真拿到 message 才算,否则界面上会出现一条空的红条。
 */
export const bounceReason = (d: MailDetail | null | undefined): string =>
  typeof d?.error?.message === 'string' ? d.error.message.trim() : '';

/**
 * 正文取哪一段。后端「没有 HTML」的哨兵是**字符串 `'false'`**,不是空串也不是 null;
 * 直接判真假会把这四个字母渲染到屏幕上。
 */
export function mailBody(d: MailDetail | null): { html: string; text: string } {
  if (!d) return { html: '', text: '' };
  const html = d.html && d.html !== 'false' ? d.html : '';
  return { html, text: html ? '' : (d.text ?? '') };
}

/** 发件人展示名。照抄旧项目的回落链,少一档就会出现一片空白的发件人 */
export function senderName(d: { from?: string; sender?: string }, unknown: string): string {
  const from = (d.from ?? '').trim();
  if (from) {
    const lt = from.indexOf('<');
    const name = (lt >= 0 ? from.slice(0, lt) : '').trim().replace(/^["']|["']$/g, '');
    if (name) return name;
    const addr = lt >= 0 ? from.slice(lt + 1).replace('>', '') : from;
    return addr.split('@')[0] || unknown;
  }
  const sender = (d.sender ?? '').trim();
  if (sender) return sender.includes('@') ? sender : `来发信(${sender})`;
  return unknown;
}

/** 头像字符:首字母大写 + 第二个字母小写。取不到用「无」 */
export function avatarChars(name: string): string {
  const s = (name ?? '').trim();
  if (!s) return '无';
  return s.length === 1 ? s.toUpperCase() : s[0].toUpperCase() + s[1].toLowerCase();
}

/**
 * 按分隔符切,但**不切引号与尖括号内部** —— 显示名里带逗号是很常见的
 * Outlook 通讯录格式(`"Keller, Anna" <a@x.com>`),正则很难同时兼顾两者,
 * 所以走一遍字符。地址解析与粘贴切分共用这一份。
 */
export function splitTopLevel(raw: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let buf = '';
  let quoted = false;
  let angle = false;
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    else if (ch === '<' && !quoted) angle = true;
    else if (ch === '>' && !quoted) angle = false;
    else if (sep.test(ch) && !quoted && !angle) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/**
 * `"张三" <a@b.com>, c@d.com` → 拆成一个个地址。
 *
 * 逗号不能直接 split:显示名里就带逗号(`"Keller, Anna" <a@x.com>` 是很常见的
 * Outlook 通讯录格式),正则很难同时兼顾引号和尖括号,所以这里走一遍字符。
 */
export function parseAddressList(raw: string | undefined): { name: string; email: string }[] {
  if (!raw?.trim()) return [];
  return splitTopLevel(raw, /[,;\n]/).map((one) => {
    const m = one.match(/^(.*?)<([^>]+)>$/);
    if (m) return { name: m[1].trim().replace(/^["']|["']$/g, ''), email: m[2].trim() };
    return { name: '', email: one };
  });
}
