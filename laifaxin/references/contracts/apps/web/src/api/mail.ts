import {
  createMailApi,
  createMailMoveApi,
  createMailReadApi,
  createMailTrashApi,
} from '@laifaxin/api-client/mail';
import {
  escapeRegExp,
  isCustomTag,
  isDraftsBox,
  isSpamBox,
  isTrashBox,
  type MailDetail,
  type MailListQuery,
  type MailNode,
  type MailRow,
  type MailScope,
  type MailScopeOption,
  type MailTag,
  mailBody,
  mailListBody,
} from '@laifaxin/core/mail';
import { isValidAddress } from '@laifaxin/core/mail-address';
import { displayHtmlToText } from '@laifaxin/core/text';

export * from '@laifaxin/core/mail-address';

import { postEnvelope, postEnvelopeFull } from '@/api/auth';
import { prepareHtmlTranslation } from '@/api/mail-translate-html';

export * from '@laifaxin/core/mail';

const mailApi = createMailApi({ postEnvelope });
export const { listMailAccounts, listMails } = mailApi;

/** 查看、回复和转发共用完整正文，并由详情查询缓存下载后的结果。 */
export async function openMail(id: string): Promise<MailDetail | null> {
  const mail = await mailApi.openMail(id);
  if (!mail) return null;
  const html = typeof mail.html === 'string' && mail.html.trim() !== 'false' ? mail.html : '';
  if (html.trim()) return mail;
  const text = typeof mail.text === 'string' ? mail.text : '';
  if (!mail.downloadUrl?.trim()) return { ...mail, html: '', text };
  // text 可能只是列表摘要；HTML 缺失时仍从 EML 恢复完整正文。
  // 普通邮件不加载 MIME 解析器；失败交给现有详情/写信错误页重试，不能当成空正文成功。
  const { downloadMailBody } = await import('@/api/mail-eml');
  return { ...mail, ...(await downloadMailBody(mail.downloadUrl)) };
}

export const listMailTags = () =>
  postEnvelope<MailTag[] | undefined>('/contacts/tags-list', { type: 'mail' }).then((r) =>
    (r ?? [])
      .map((tag, index) => ({ ...tag, builtin: !isCustomTag(index) }))
      .filter((tag) => !tag.folder),
  );

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/* ==================================================================
   写操作(批次 2)
   ================================================================== */

/**
 * 批量操作的范围。**与客户管理那一套不是一回事,不要复用 `baseParams()`**:
 * - 主键数组叫 `ids` 不叫 `selectKeys`
 * - **没有 `selectTotal`**
 * - 只有两档:`current`(勾中的这几封)/ `all`(当前条件下全部),
 *   **后端没实现 `front`**
 *
 * `selectOption === 'all'` 时后端**丢弃 ids**、用 `filter + owners` 重算全量;
 * 但 DTO 仍然要求 `ids` 非空(`min(1).max(256)`),所以全选时也要带上当前页的
 * id 占位 —— 少了这一步会 422。
 */
/**
 * 由当前列表条件 + 勾中的 id 拼出批量参数。
 *
 * ⚠️ **`filter.boxName` 不允许空串** —— 后端 DTO 是 `RuleType.string()`,
 * 空串会 422。而 `selectOption:'all'` + 空 filter 在后端等于「这个 uid 下的所有邮件」,
 * 叠上删除就是一次全量误伤。所以这里宁可抛,也不发一个空条件出去。
 */
export function mailScope(q: MailListQuery, ids: string[], option: MailScopeOption): MailScope {
  const body = mailListBody(q);
  const filter = body.filter as Record<string, unknown>;
  if (option === 'all' && !filter.boxName && !filter.tagsId && !filter.keyword) {
    // 走到这里说明调用方没挡住「没有任何条件时的全选」,那是能删光收件箱的
    throw new Error('批量范围为「全部」时筛选条件不能为空');
  }
  return { ids, filter, owners: body.owners, selectOption: option };
}

/* ---------- 定时发送 ---------- */

/**
 * 「定时中」的 status。后端把定时邮件存在**草稿箱**里,靠 `status: 9` 区分
 * (`service/mail.ts:3162` 的 `countDocuments({uid, _id, status: 9})`)。
 * 不认这个值的话,定时邮件在界面上和普通草稿一模一样 —— 用户找不到它、
 * 也不知道它到点会自己发出去。
 */
export const MAIL_STATUS_SCHEDULED = 9;

export const isScheduled = (m: { status?: number; timeStart?: number } | null | undefined) =>
  m?.status === MAIL_STATUS_SCHEDULED || (m?.timeStart ?? 0) > 0;

/**
 * 取消定时发送。成功后这封信变回普通草稿(`{timeStart: null, status: 1}`)。
 *
 * ⚠️ **这个接口恒回 `success: true`。** controller 里
 * `await this.mailService.mailCancelTimer(uid, id); return { success: true };`
 * —— service 的返回值直接丢了。而它在两种情况下会返回 false:
 * 这封信已经不是 status 9(比如刚被发出去),或者抢不到 redis 锁(正在发)。
 * 也就是说**「取消成功」不代表真的拦下来了**,调用方必须重新拉一次列表,
 * 让用户看到它现在到底在草稿箱还是已发送。
 */
export const cancelMailTimer = (id: string) => postEnvelope<unknown>('/mails/cancel-timer', { id });

/**
 * 改定时时间。`timeStart` 传 0 等于取消(后端 summary 写的是
 * 「修改定时发送(修改时间或取消发送)」)。
 *
 * 这个**会**如实回 `success:false` + message,与上面那个不一样。
 * 后端还卡了两条:必须是将来的时间、必须在 90 天以内 —— 前端先拦一道,
 * 免得用户填完才被打回来。
 */
export const changeMailTimer = (id: string, timeStart: number) =>
  postEnvelopeFull<unknown>('/mails/change-timer', { id, timeStart });

/** 定时时间的上限:90 天,照后端 `now + 86400 * 1000 * 90` */
export const TIMER_MAX_AHEAD = 90 * 24 * 3600 * 1000;

export function validateTimer(timeStart: number, now = Date.now()): 'past' | 'tooFar' | null {
  if (!Number.isFinite(timeStart) || timeStart <= now + 1000) return 'past';
  if (timeStart > now + TIMER_MAX_AHEAD) return 'tooFar';
  return null;
}

/**
 * 这批邮件能移到哪些目录。
 *
 * 三道约束都来自后端 `mailMove` 只写 boxName 这件事(见 {@link moveMail}):
 *
 * - **只取顶层目录**(`parent === ''`)。子目录的 parent 不是空串,
 *   移过去 parent 对不上,邮件会从所有目录视图里消失。
 * - **取所有涉及账号的交集**。选中的信可能来自不同账号(聚合视图下常见),
 *   而 maid 不会被改写 —— 目标目录名在某个账号里不存在,那几封就消失。
 * - **去掉草稿箱**:草稿移进普通目录之后既不是草稿也发不出去。
 *
 * 回收站**留在列表里**(用户就是想移进去),但调用方要把它路由到 deleteMails ——
 * 那条路会按每封信自己的账号找回收站、并且 parent 和 boxName 一起写。
 */
export function movableBoxes(
  tree: MailNode[],
  maids: string[],
  currentBoxName: string,
): MailNode[] {
  if (maids.length === 0) return [];
  const topOf = (maid: string) =>
    (tree.find((a) => a.maid === maid)?.children ?? []).filter((b) => (b.parent ?? '') === '');
  const first = topOf(maids[0]);
  return first.filter((b) => {
    if (b.boxName === currentBoxName) return false;
    if (isDraftsBox(b.boxName)) return false;
    // 其余账号也得有同名目录,否则那几封会消失
    return maids.every((m) => topOf(m).some((x) => x.boxName === b.boxName));
  });
}

/** 彻底删除:deleteOne + 删 OSS 目录,**不可恢复**。调用前必须二次确认 */
export const dropMail = (id: string) => postEnvelope('/mails/mail-drop', { id });

/**
 * 移动到别的目录。**单封**,后端没有批量接口(全仓 `mails-move` 零命中)。
 *
 * ⚠️ **只写 `boxName`,不写 `parent`**(`service/mail.ts:1283` 的
 * `updateOne({_id, uid}, { boxName })`),而列表查询是
 * `{uid, maid, parent, boxName}` **整组精确匹配**(`getFilterQuery:701`)。
 * 两条后果,{@link movableBoxes} 就是为它们存在的:
 *
 * 1. **只能在同一层的目录之间移。** 把顶层的信移进子目录(parent 该变成 'INBOX'
 *    却仍是 ''),它就既不在原目录也不在目标目录 —— **在任何目录视图里都点不出来**,
 *    只有关键词搜索还能捞到(搜索分支不带 parent)。
 * 2. **不能跨账号。** maid 从头到尾没写回,目标目录名在对方账号里不存在的话,
 *    同样是上面那种「消失」。
 *
 * ⚠️ **success 恒为 true**:controller 把 service 的返回值整个丢了
 * (`controller/mail.ts:499`),而 service 在邮件不存在时返回 false。
 * 「移动成功」不代表动了任何东西,调用方必须重拉列表以服务端为准。
 *
 * ⚠️ **移到回收站不能用它** —— 见 {@link isTrashBox} 处的说明与 deleteMails。
 */
export const { moveMail } = createMailMoveApi({ postEnvelope });

/**
 * 用列表核对移动结果，不能调用 openMail：打开未读邮件会把它标成已读。
 * 有主题时先按主题缩小结果，再严格核对 id、账号和完整目录；无主题时查目标目录。
 */
export async function confirmMailMove(
  row: MailRow,
  box: MailNode,
  owners: string[],
  signal?: AbortSignal,
) {
  const pageSize = 100;
  // 列表接口只接受 1–1000 页。找不到时保持“未确认”，不能误报成功。
  for (let current = 1; current <= 1000; current++) {
    signal?.throwIfAborted();
    const result = await listMails({
      current,
      pageSize,
      maid: row.maid || box.maid,
      parent: box.parent ?? '',
      boxName: box.boxName,
      keyword: row.subject?.trim() || '',
      tagsId: '',
      read: 'all',
      owners,
    });
    signal?.throwIfAborted();
    const found = result.list.find((item) => item._id === row._id);
    if (found) {
      return (
        found.maid === row.maid &&
        found.boxName === box.boxName &&
        (found.parent ?? '') === (box.parent ?? '')
      );
    }
    if (!result.list.length || current * pageSize >= result.total) break;
  }
  return false;
}

/**
 * 「分类不准」反馈。**请求键名是 `mailId` 不是 `id`**。
 *
 * ⚠️ **只收 mailId,不收「正确答案」** —— 后端存一条报告,然后
 * `$pull` 掉那 5 个内置标签(`service/mail.ts:1312`)。所以:
 * - 做不了「纠正为询盘」这种交互,后端不接收正确分类
 * - 也拿不到「已反馈」状态(读接口在 admin 那边),只能靠标签被摘空间接表现
 * - **别用 mails-tags 假装实现**:那是 `updateMany(query, {tags})` 整体覆盖,
 *   会把用户自定义标签一起冲掉,而且完全不碰 sorting,横幅照旧显示旧结论
 */
export const reportSorting = (mailId: string) =>
  postEnvelope('/mails/mail-sorting-report', { mailId });

/**
 * 举报的四个选项。**前三个进 `options`,第四个是独立的一次
 * `mails-address-black`** —— 旧项目把它混在同一个弹窗里,两个请求互不等待、
 * 互不回滚,只有前者弹成功提示。
 *
 * 后端对 `options` 的处理:`black` → 写收信黑名单;`spam` → 把该发信人所有邮件
 * 搬进垃圾邮件(**仅聚合视图的邮件生效**);`report` → **没有任何分支**,
 * 只是随请求体存进 report 文档。
 */
export const REPORT_OPTIONS = ['black', 'spam', 'report'] as const;
export type ReportOption = (typeof REPORT_OPTIONS)[number];

/* ---------- 批量 ---------- */

/** 批量移入回收站。`deletedCount` 类型不稳,用 `deletedCountOf` 读 */
export const { deleteMails } = createMailTrashApi({ postEnvelope });

/**
 * 后端在中途遇到「没有回收站的账号」时,会把一个
 * `{success:false, message:'回收站未找到'}` **对象**塞进 `deletedCount`。
 * 直接拿去 toLocaleString 会渲染出 [object Object]。
 */
export function deletedCountOf(d: { deletedCount?: unknown } | undefined): number | null {
  return typeof d?.deletedCount === 'number' &&
    Number.isFinite(d.deletedCount) &&
    d.deletedCount >= 0
    ? d.deletedCount
    : null;
}

/** 批量彻底删除,**不可恢复** */
export const dropMails = (scope: MailScope) => postEnvelope('/mails/mails-drop', scope);

export const { markMailsSeen, markMailsUnseen } = createMailReadApi({ postEnvelope });

/**
 * 批量打邮件分类。**后端是 `updateMany(query, { tags })` 整体覆盖,不是增量** ——
 * 空数组就是清空。所以弹窗必须先把当前分类回填进去,让用户在已有基础上改,
 * 否则勾一个等于把其余的(包括 AI 打的系统标签)全抹掉。
 */
export const setMailsTags = (scope: MailScope, tags: string[]) =>
  postEnvelope('/mails/mails-tags', { ...scope, tags });

/**
 * 给**联系人**打标签(不是给邮件)—— 取邮件的 from 解析出邮箱,
 * 去 customer 表上打。
 *
 * `action` 的后端映射很反直觉:`'pull'|'del'|'delete'` → 移除,
 * `'replace'` → 覆盖,**其余一切值(含 `'add'`)→ 追加**。
 */
export type AddressTagAction = 'add' | 'pull' | 'replace';
export const setAddressTags = (scope: MailScope, tags: string[], action: AddressTagAction) =>
  postEnvelope('/mails/mails-address-tags', { ...scope, tags, action });

/**
 * 把发件人地址加进**客户黑名单**。
 * ⚠️ 与 `black-add`(拒收)写的是**两张不同的表**:这个写 customerBlackDomain,
 * 那个写 mailBlacklist。界面上要分清楚,别都叫「加入黑名单」。
 */
export const BLACK_TYPES = ['search', 'send'] as const;
export type BlackType = (typeof BLACK_TYPES)[number];

export const setAddressBlack = (
  scope: MailScope,
  v: { blackAction: 'add' | 'delete'; blackTypes: BlackType[]; blackComment: string },
) => postEnvelope('/mails/mails-address-black', { ...scope, ...v });

/** 批量举报。**没有 address / mailId**,后端自己从命中的邮件里取发件人 */
export const reportMails = (scope: MailScope, options: string[]) =>
  postEnvelope('/mails/reports-add', { ...scope, options });

/* ---------- 目录 ---------- */

/** 整个目录标记已读 */
export const markDirSeen = (v: { maid: string; parent: string; boxName: string }) =>
  postEnvelope('/mails/mails-dir-seen', v);

/** 清空目录。**deleteMany 硬删,不可恢复**,且不删 OSS */
export const clearDir = (v: { maid: string; parent: string; boxName: string }) =>
  postEnvelope('/mails/mails-dir-clear', v);

/**
 * 「清空文件夹」只在这三类目录上出现。
 * 旧项目按**翻译后的中文名**精确匹配,于是 QQ / 163 那种「已删除邮件」「垃圾箱」
 * 看不到这个入口 —— 这里改成按归一化后的类型判,口径才稳。
 */
export const canClearDir = (boxName: string) =>
  isTrashBox(boxName) || isDraftsBox(boxName) || isSpamBox(boxName);

/* ==================================================================
   写信(批次 3)
   ================================================================== */

/**
 * 写信的六种模式。
 *
 * ⚠️ 旧项目这一路有**两套拼写并存**:组件 prop 用 `replay`(回复,少个 y)
 * 和 `replyAll`,而 `getInitalEmailState` 的第二参用 `replay` / `replayAll`。
 * 新项目只留一套正确拼写,下游不必再认两个。
 */
export const COMPOSE_MODES = ['new', 'reply', 'replyAll', 'forward', 'edit', 'reEdit'] as const;
export type ComposeMode = (typeof COMPOSE_MODES)[number];

export interface ComposeDraft {
  /** 草稿 id。第一次 mail-save 之后才有 */
  id?: string;
  /** 发信账号。**不含 @ 的走系统通道扣通用点数** */
  sender: string;
  maid: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  attachments: { url: string; name: string; size: number }[];
  /** 附件库里选的,传的是那一行的 `value` 不是 `id` */
  attIds: string[];
  /** 分别发送:每个收件人单独一封 */
  single: boolean;
  track: boolean;
  readReceipt: boolean;
  priority: '1' | '2' | '3' | null;
  /** 定时发送的时间戳(ms)。为空就是立即发 */
  timeStart: number | null;
  /**
   * 被回复的那封信的 `_id`。发出去之后后端把它置成 `status: 2`(已回复),
   * 列表里那一行才会出现「已回复」的标记。
   *
   * ⚠️ 前端原来**根本不发这两个字段**,所以原邮件永远停在已读态。
   */
  replyId?: string;
  /**
   * 被转发的那封信的 `_id`,对应 `status: 5`(已转发)。
   *
   * ⚠️ **后端这一支现在是坏的**:`if (forwardId && isObjectId(replyId))`
   * (`service/mail.ts:2455`)—— 校验的是 replyId 而不是 forwardId。
   * 只转发不回复时 replyId 为空,这个 updateOne 永远不执行。
   * 前端照样按正确的语义发,后端把那个拼写修掉就自动生效;
   * 我们这边不做任何绕过(绕过意味着替后端的 bug 兜底,以后更难发现)。
   */
  forwardId?: string;
}

/**
 * 主题前缀。
 *
 * ⚠️ 旧项目是 `Re:${subject}` / `Fw:${subject}` —— **没有空格、不去重、
 * 用的是 `Fw` 不是 `Fwd`**,来回几轮会叠成 `Re:Re:Re:xxx`。
 * 这里加了空格并去重(已有前缀就不再叠),但**保留 `Fw:` 这个拼法** ——
 * 改成 `Fwd:` 会影响历史邮件的线程识别,属于产品决策,不在这一批里动。
 */
export function subjectPrefix(mode: ComposeMode, subject: string): string {
  const s = (subject ?? '').trim();
  if (mode === 'reply' || mode === 'replyAll') {
    return /^re:\s*/i.test(s) ? s : `Re: ${s}`;
  }
  if (mode === 'forward') {
    return /^fw:\s*/i.test(s) ? s : `Fw: ${s}`;
  }
  return s;
}

/** 发信时的请求体。`attNormal` 前端恒发 true(旧项目也是硬编码) */
export function composeBody(d: ComposeDraft) {
  const body: Record<string, unknown> = {
    maid: d.maid,
    sender: d.sender,
    to: d.to.join(','),
    subject: d.subject,
    html: d.html,
    single: d.single,
    track: d.track,
    attNormal: true,
    attIds: d.attIds,
    attachments: d.attachments,
    readReceipt: d.readReceipt,
    sendAtOnce: d.timeStart == null,
  };
  if (d.cc.length) body.cc = d.cc.join(',');
  if (d.bcc.length) body.bcc = d.bcc.join(',');
  // 优先级与已读回执只在自有邮箱分支才写进 SMTP header,系统通道下发了也没用
  if (d.priority) body.priority = d.priority;
  if (d.timeStart != null) body.timeStart = d.timeStart;
  if (d.id) body.id = d.id;
  // 不发的话原邮件永远变不成「已回复 / 已转发」—— 列表里那个标记就一直不出现
  if (d.replyId) body.replyId = d.replyId;
  if (d.forwardId) body.forwardId = d.forwardId;
  return body;
}

export interface SendTicket {
  sendId?: string;
  /** 定时发送保存到草稿箱后的邮件 ID。 */
  id?: string;
}

export const sendMail = (d: ComposeDraft) =>
  postEnvelope<SendTicket | undefined>('/mails/sendmail-add', composeBody(d));

export interface SendStatus {
  status: '' | 'running' | 'finished';
  total: number;
  finished: number;
  success: number;
  /** **是 `failed` 不是 `fail`** */
  failed: number;
  results: { to: string; success: boolean; message?: string }[];
}

export const getSendStatus = (sendId: string) =>
  postEnvelope<Partial<SendStatus> | undefined>('/mails/sendmail-status', { sendId }).then(
    (d): SendStatus => ({
      status: (d?.status as SendStatus['status']) ?? '',
      total: num(d?.total),
      finished: num(d?.finished),
      success: num(d?.success),
      failed: num(d?.failed),
      results: Array.isArray(d?.results) ? d.results : [],
    }),
  );

/** 存草稿。新建回 `{id}`,更新**不回 data** */
export const saveDraft = (d: ComposeDraft) =>
  postEnvelope<{ id?: string } | undefined>('/mails/mail-save', {
    ...composeBody(d),
    text: displayHtmlToText(d.html),
  });

/** 草稿指纹:内容没变就不重复存 */
export const draftFingerprint = (d: ComposeDraft) =>
  JSON.stringify([
    d.sender,
    d.maid,
    d.to,
    d.cc,
    d.bcc,
    d.subject,
    d.html,
    d.attachments.map((a) => [a.url, a.name, a.size]),
    d.attIds,
    d.single,
    d.track,
    d.readReceipt,
    d.priority,
  ]);

/**
 * 定时发送的时间校验。后端要求 `> now + 1s` 且 `< now + 90 天`。
 *
 * ⚠️ 旧项目两处文案都写反了(拦的是「早于」却说「不能晚于」),这里按实际语义写。
 */
export const SCHEDULE_MAX_DAYS = 90;
export function validateSchedule(ts: number, now = Date.now()): string | undefined {
  if (!Number.isFinite(ts)) return 'compose.errScheduleInvalid';
  if (ts <= now + 1000) return 'compose.errScheduleTooEarly';
  if (ts > now + SCHEDULE_MAX_DAYS * 24 * 3600 * 1000) return 'compose.errScheduleTooLate';
  return undefined;
}

/** 发送前的完整校验。返回第一条不满足的原因,全过则 undefined */
export function validateCompose(d: ComposeDraft, uploading: boolean): string | undefined {
  if (uploading) return 'compose.errUploading';
  if (d.timeStart != null) {
    const badTime = validateSchedule(d.timeStart);
    if (badTime) return badTime;
  }
  if (d.to.length === 0) return 'compose.errNoTo';
  if ([...d.to, ...d.cc, ...d.bcc].some((a) => !isValidAddress(a))) return 'compose.errBadTo';
  if (d.cc.length > 20) return 'compose.errCcMax';
  if (d.bcc.length > 20) return 'compose.errBccMax';
  if (!d.subject.trim()) return 'compose.errNoSubject';
  if (!d.sender) return 'compose.errNoSender';
  // 旧项目把这一条注释掉了 —— 清空正文点发送,校验静默失败、界面零反馈
  if (!hasContent(d.html)) return 'compose.errNoBody';
  return undefined;
}

/** 富文本里有没有真内容(空段落、空白、只有 <br> 都不算) */
export function hasContent(html: string): boolean {
  const template = document.createElement('template');
  template.innerHTML = html;
  return (
    !!template.content.textContent?.trim() ||
    Array.from(template.content.querySelectorAll('img[src]')).some((img) =>
      Boolean(img.getAttribute('src')?.trim()),
    )
  );
}

/** 系统邮箱单次收件人上限。自有邮箱不受限 */
export const SYSTEM_SEND_MAX = 20;
export const isSystemSender = (sender: string) => !sender.includes('@');

/* ---------- 写信要用的几个辅助接口 ---------- */

/** 收件人补全的一条。后端还回 name / _id,旧项目没用 */
export interface MailToOption {
  email: string;
  first_name?: string;
  last_name?: string;
  name?: string;
}

/**
 * 收件人补全。**不是 `/contacts/people-search`** —— 那个返回 cid+email,是另一回事。
 *
 * keyword 直接进后端的正则,**后端没做转义** —— 见 {@link escapeRegExp}。
 */
export const mailToOptions = (keyword: string) =>
  postEnvelope<MailToOption[] | undefined>('/contacts/mail-to-options', {
    keyword: escapeRegExp(keyword),
  }).then((r) => r ?? []);

/** 补全项 → 一条完整地址。名字为空时只留尖括号形式 */
export function optionToAddress(o: MailToOption): string {
  const name =
    [o.first_name, o.last_name].filter(Boolean).join(' ').trim() || (o.name ?? '').trim();
  return name ? `${name} <${o.email}>` : `<${o.email}>`;
}

/** 附件库里的一条。**`attIds` 要传 `value`,传 `id` 会静默没有附件** */
export interface AttachmentOption {
  name?: string;
  showname?: string;
  url?: string;
  /** OSS 文件 id —— 不是要发给后端的那个 */
  id: string;
  label: string;
  /** 这个才是 attIds 要的值 */
  value: string;
  size: number;
  create_time?: number;
}

export const listAttachmentOptions = () =>
  postEnvelope<AttachmentOption[] | undefined>('/mailbox/attachment-options', {}).then(
    (r) => r ?? [],
  );

/* ==================================================================
   详情深水区(批次 4):联系人卡片 / 追踪 / 往来 / 翻译
   ================================================================== */

/* ---------- 地址上的联系人卡片 ---------- */

export interface EmailContact {
  /** 联系人 id。**没有它就说明这个地址还不是联系人** */
  cid?: string;
  /** 公司 id —— 与 cid 是两个不同的字段,别混 */
  c_id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  domain?: string;
  orgName?: string;
  c_name?: string;
  position?: string;
  tagsList?: { id: string; name: string; color?: string }[];
  isBlack?: boolean;
}

/**
 * 按邮箱查联系人。**查不到时后端回的是 `{}`(空对象,不是 null)**,
 * 所以判断「是不是联系人」要看 `cid` 有没有,不能判 data 真假。
 */
export const getEmailContact = (email: string) =>
  postEnvelope<EmailContact | undefined>('/contacts/email-info', { email }).then((d) => d ?? {});

/* ---------- 邮件追踪 ---------- */

export interface TrackRecord {
  _id?: string;
  act?: string;
  time?: number;
  email?: string;
  /** 链接点击目标、附件名称或回复内容，由服务端的 content 字段保存 */
  other?: string;
  ip?: string;
  device?: string;
  country?: string;
  regionName?: string;
  city?: string;
  county?: string;
}

/** 追踪记录。**传的是 `mail.ssid` 不是 `_id`** —— 参数名叫 sid,值取错就永远是空列表 */
export const getTrackInfo = (ssid: string) =>
  postEnvelope<unknown>('/mails/track-info', { sid: ssid }).then((result): TrackRecord[] => {
    if (result == null) return [];
    if (!Array.isArray(result)) throw new Error('Invalid tracking records');
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : undefined);
    return result
      .map((record): TrackRecord => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw new Error('Invalid tracking record');
        }
        const time = record.time;
        return {
          _id: text(record._id),
          act: text(record.act),
          email: text(record.email),
          other: text(record.other),
          time:
            typeof time === 'number' && time > 0 && Number.isFinite(new Date(time).getTime())
              ? time
              : undefined,
          ip: text(record.ip),
          device: text(record.device),
          country: text(record.country),
          regionName: text(record.regionName),
          city: text(record.city),
          county: text(record.county),
        };
      })
      .sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  });

/** 把地区几段拼成一行,空的段跳过 */
export const trackPlace = (r: TrackRecord) =>
  [r.country, r.regionName, r.city, r.county].filter(Boolean).join(' · ');

/* ---------- 邮件往来 ---------- */

export type HistoryRange = 'all' | 'from' | 'to';

export interface MailHistoryQuery {
  email: string;
  rangeType: HistoryRange;
  current: number;
  pageSize: number;
  owners: string[];
  sort?: { timestamp: 1 | -1 };
  /** 时间区间;不限就留空 */
  timestamp?: [number, number];
}

export interface MailHistoryRow extends MailRow {
  sender?: string;
  track?: string | boolean;
  readed?: number;
}

/**
 * 与某个地址的往来邮件。
 *
 * ⚠️ **filter 里只能有这四个键**:后端是
 * `const { email, rangeType, timestamp, owners, ...query } = filter`,
 * **剩下的键会被当成 mongo 查询条件直接拼进去** —— 旧项目把整个 state 原样
 * spread 进来(还带着一个 `total`),等于把前端的分页状态当查询条件发了出去。
 */
export const listMailHistory = (q: MailHistoryQuery) =>
  postEnvelope<{ list?: MailHistoryRow[]; total?: number } | undefined>(
    '/mails/mail-history-list',
    {
      current: q.current,
      pageSize: q.pageSize,
      sort: q.sort ?? {},
      filter: {
        email: q.email,
        rangeType: q.rangeType,
        owners: q.owners,
        ...(q.timestamp ? { timestamp: q.timestamp } : {}),
      },
    },
  ).then((d) => ({ list: Array.isArray(d?.list) ? d.list : [], total: num(d?.total) }));

/* ---------- 翻译 ---------- */

/**
 * 支持的目标语种。与后端 DTO 的清单一致,默认译成中文。
 */
export const TRANSLATE_LANGS = [
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'es',
  'it',
  'de',
  'tr',
  'ru',
  'pt',
  'vi',
  'id',
  'th',
  'ms',
] as const;
export type TranslateLang = (typeof TRANSLATE_LANGS)[number];

/** 一次最多 256 条,后端 DTO 卡的 */
export const TRANSLATE_MAX_CHUNKS = 256;

export interface MailTranslation {
  subject: string;
  /**
   * 回填了译文的 HTML,**原排版一个标签都没动**。
   * 只有原邮件是 HTML 时才有;纯文本邮件走 {@link MailTranslation.paragraphs}。
   */
  html: string;
  /** 逐段译文,给纯文本邮件用 */
  paragraphs: string[];
  /** 段落太多被截断了 —— 前面翻了、后面是原文 */
  truncated: boolean;
  /** 已请求的段落中有缺失译文；相应位置保留原文，可重试。 */
  incomplete?: boolean;
}

/**
 * 纯文本正文拆段。**只给没有 HTML 的邮件用** ——
 * 有 HTML 的走 {@link prepareHtmlTranslation},那条路保排版。
 */
export function plainChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const line of text.split(/\n{1,}|(?<=[。.!?！？])\s{2,}/)) {
    const t = line.replace(/\s+/g, ' ').trim();
    if (t) chunks.push(t);
  }
  return chunks;
}

/** 正文有没有能翻译的内容。`'false'` 是后端「没有 HTML」的哨兵 */
export function hasTranslatableContent(subject: string, html: string, text: string): boolean {
  const realHtml = html && html !== 'false' ? html : '';
  return !!(subject.trim() || (realHtml ? prepareHtmlTranslation(realHtml).count : text.trim()));
}

/**
 * 翻译。
 *
 * ⚠️ **打的是 `/tools/lang-translate` 而不是旧前端那个 `/mailbox/mail-translate`**。
 * 写这段时后者在服务端全仓零命中;它是 2026-09-02 的 commit「邮箱翻译功能」
 * 才加的(`controller/mailbox.ts:1089`),比这段注释晚一天。
 * 那条路带 OSS eml 回捞和按 (mailId, target) 落库缓存,值得单独换过去,
 * 但那是另一件事,不在这次修复范围。
 *
 * ⚠️ **返回体里 `textList` 是原文回显,`targetTextList` 才是译文。**
 * 上游 `/v2/tools/lang/translate` 原样透传,后端自己在
 * `service/mail.ts:1553` 读的就是 `data?.targetTextList?.[0]`。
 * 读错的后果没有任何征兆:转圈、按钮切「显示原文」、截断提示全都正常,
 * 只是每一格填回去的都是原文 —— 界面上等于点了个没反应的按钮。
 */
export async function translateMail(v: {
  subject: string;
  html: string;
  text: string;
  target: TranslateLang;
}): Promise<MailTranslation> {
  const realHtml = v.html && v.html !== 'false' ? v.html : '';
  // HTML 邮件走保排版那条路:只把文本节点送去翻,回来原样填回去
  const prepared = realHtml ? prepareHtmlTranslation(realHtml) : null;
  const bodyChunks = prepared ? prepared.textList : plainChunks(v.text);

  // 主题和正文同一次请求发出去 —— 拆成两次是白白多一个来回。
  //
  // ⚠️ **主题为空时不占位**。回填是按下标对应的,而 textList 里唯一可能为空的
  // 就是主题(正文单元都过了 worthTranslating,必有实字)。真要发一个空串出去,
  // 后端一旦把空条目过滤掉,回来的数组就整体前移一格 —— 那时排版是完整的、
  // 每一格的内容却全错位,比不翻还糟,而且看不出来。
  const subject = v.subject.trim();
  const all = subject ? [subject, ...bodyChunks] : bodyChunks;
  const truncated = all.length > TRANSLATE_MAX_CHUNKS;
  const textList = all.slice(0, TRANSLATE_MAX_CHUNKS);

  if (!textList.length) {
    return { subject: v.subject, html: realHtml, paragraphs: bodyChunks, truncated: false };
  }

  const out = await postEnvelope<unknown>('/tools/lang-translate', {
    source: 'auto',
    target: v.target,
    textList,
  });
  // 顺序不能颠倒:targetTextList 才是译文,textList 是原文回显。
  // 裸数组那一支留着是因为上游历史上这么回过,当译文处理
  const payload = out && typeof out === 'object' ? (out as Record<string, unknown>) : {};
  const candidate = Array.isArray(out) ? out : (payload.targetTextList ?? payload.textList);
  // 空响应或全部无效不能伪装成翻译完成；交给界面保留原文并提供重试。
  if (!Array.isArray(candidate)) throw new Error('Invalid translation response');
  const list = textList.map((_, index) => {
    const value = candidate[index];
    return typeof value === 'string' && value.trim() ? value : '';
  });
  if (!list.some(Boolean)) throw new Error('Empty translation response');
  const body = subject ? list.slice(1) : list;

  return {
    subject: (subject ? list[0] : '') || v.subject,
    // 超限时 body 比单元少,apply 会把没译到的留成原文 —— 半篇译文好过整篇不译
    html: prepared ? prepared.apply(body) : '',
    // 纯文本也必须逐段回退，不能因为响应少回或超过上限而丢掉邮件后半部分。
    paragraphs: prepared ? [] : bodyChunks.map((chunk, index) => body[index] || chunk),
    truncated,
    incomplete: list.some((value) => !value),
  };
}

/**
 * 展示用的正文与主题。
 *
 * ⚠️ **回复 / 转发 / 再次编辑一律传原始 mail,绝不能传这个的结果** ——
 * 否则机翻正文会被当成正文发给真实客户。旧项目为这条专门写了一个源码文本级的
 * 护栏测试,新项目的等价护栏在 `mail-translate.test.ts`。
 */
export function pickMailContent(
  mail: MailDetail,
  translation: MailTranslation | undefined,
  showTranslated: boolean,
): { subject: string; html: string; text: string } {
  const { html, text } = mailBody(mail);
  if (!showTranslated || !translation) return { subject: mail.subject ?? '', html, text };
  return {
    subject: translation.subject || (mail.subject ?? ''),
    // HTML 邮件给回填了译文的 HTML(排版原样);纯文本邮件才落到段落
    html: translation.html || '',
    text: translation.html ? '' : translation.paragraphs.join('\n\n') || text,
  };
}
