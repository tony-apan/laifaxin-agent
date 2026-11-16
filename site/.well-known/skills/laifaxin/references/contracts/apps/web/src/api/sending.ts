import i18n from 'i18next';
import { AuthError, postEnvelope, postEnvelopeFull } from '@/api/auth';
import { PermissionDeniedError, SessionExpiredError } from '@/api/client';
import type { PageResult } from '@/api/expenses';

/**
 * 设置 · 发信基础设施三件套:邮箱账号 / 发信通道账号 / 发送时段。
 *
 * 老项目这三页分散在 `settings/mailaccounts`、`settings/systemaccounts`+`settings/senders`、
 * `settings/sequence` 三处,字段命名、分页信封、主键写法各不相同。本模块把它们收敛成
 * 一套口径,差异逐条记在下面,免得联调时以为是新写的 bug:
 *
 * - **主键对外一律 `id`**。邮箱账号后端叫 `maid`,通道账号与发送时段读 `_id`、
 *   写 `id` —— 同一个概念三个名字,在拆包/装包处统一。
 * - **分页信封两种形状**:`accounts-show` 把 `total` 挂在 `data` 的兄弟位,
 *   `sender-list`/`schedule-list` 是 `data:{list,total,current}`。都收敛成 `{list,total,current}`,
 *   两种形状不带进业务代码。
 * - **`re_status`/`se_status` 同名两义**:列表里是字符串枚举,新增/保存的连接测试里是布尔。
 *   拆成 {@link MailStatus} 与 {@link MailVerifyResult} 两个类型,不复用。
 * - 编辑时密码留空保留已加载的凭据，以兼容保存接口的必填校验；
 *   原凭据不回显，用户新输入始终优先，不按输入长度猜测是否修改。
 * - **时间窗口是半开区间 `[start, end)`、整数小时、不跨天**,提交时写满 7 个 key。
 *   详见 {@link normalizeWindows}。
 */

/* ---------- 公共 ---------- */

export interface Paged<T> {
  list: T[];
  total: number;
  current: number;
}

const emptyPage = <T>(): Paged<T> => ({ list: [], total: 0, current: 1 });

/** `data:{list,total,current}` 三层信封 */
const unwrapPage = <T>(r: PageResult<T> | undefined): Paged<T> => ({
  list: r?.list ?? [],
  total: r?.total ?? 0,
  current: r?.current ?? 1,
});

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback = false) => (typeof v === 'boolean' ? v : fallback);
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

export interface ListQuery {
  current: number;
  pageSize: number;
  keyword?: string;
  sort?: Record<string, 1 | -1>;
}

export const DEFAULT_SORT: Record<string, 1 | -1> = { create_time: -1 };

/* ============================================================
   一、邮箱账号 MailAccount —— 用户自有的 IMAP/SMTP 个人邮箱
   ============================================================ */

/**
 * 列表里的连接状态。老项目只认 `success`/`error`/`failed`,别的一律显示「未知」;
 * 后端若改成布尔(连接测试那边就是布尔)会让整列永远「未知」,所以这里也认布尔。
 */
export type MailStatus = 'success' | 'error' | 'failed' | 'unknown';

export function mailStatus(v: unknown): MailStatus {
  if (v === true) return 'success';
  if (v === false) return 'error';
  return v === 'success' || v === 'error' || v === 'failed' ? v : 'unknown';
}

export interface MailAccountRow {
  /** 后端字段 `maid` */
  id: string;
  /** 登录账号。老项目拿它当表格 rowId —— 会重复,这里只作展示 */
  mail_acc: string;
  /** 邮箱地址。列表接口是否返回待后端确认,缺失时回落到 mail_acc */
  mail_addr: string;
  mail_name: string;
  re_status: MailStatus;
  se_status: MailStatus;
  /** 占用空间(字节)。全页唯一的用量信息,不是配额 */
  totalSize: number;
  /** 归属人 userid */
  userid: string;
  /** 创建者 userid */
  creator: string;
  create_time: number;
}

const toMailRow = (r: Record<string, unknown>): MailAccountRow => {
  const acc = str(r.mail_acc);
  return {
    id: str(r.maid),
    mail_acc: acc,
    mail_addr: str(r.mail_addr) || acc,
    mail_name: str(r.mail_name),
    re_status: mailStatus(r.re_status),
    se_status: mailStatus(r.se_status),
    totalSize: num(r.totalSize),
    userid: str(r.userid),
    creator: str(r.creator),
    create_time: num(r.create_time),
  };
};

/**
 * 列表。`total` 在信封顶层、与 `data` 平级,是这三个模块里唯一一个这样的接口。
 *
 * 老项目的搜索是假的:`filter` 恒为 `{}`,关键字只在**当前这一页**的 10 条里前端过滤,
 * 分页器却仍按服务端 `total` 显示页数 —— 过滤后看着只剩 1 条、页码还是几十页。
 * 这里把关键字放进请求体走服务端。
 */
export async function listMailAccountRows(q: ListQuery): Promise<Paged<MailAccountRow>> {
  const res = await postEnvelopeFull<Record<string, unknown>[]>('/mails/accounts-show', {
    current: q.current,
    pageSize: q.pageSize,
    filter: q.keyword ? { keyword: q.keyword } : {},
    sort: q.sort ?? DEFAULT_SORT,
  });
  const rows = Array.isArray(res.data) ? res.data : [];
  return { list: rows.map(toMailRow), total: num(res.total, rows.length), current: q.current };
}

/** 收发信各自的默认端口。SSL 与非 SSL 两套,联动时只在端口仍是默认值时才改写 */
export const MAIL_PORTS = {
  re: { ssl: 993, plain: 143 },
  se: { ssl: 465, plain: 25 },
} as const;

export const defaultPort = (kind: 're' | 'se', ssl: boolean) =>
  ssl ? MAIL_PORTS[kind].ssl : MAIL_PORTS[kind].plain;

export const isDefaultPort = (kind: 're' | 'se', port: number) =>
  port === MAIL_PORTS[kind].ssl || port === MAIL_PORTS[kind].plain;

/** 服务商要求的密码类型,决定输入框叫「密码」还是「授权码」 */
export type AuthType = 'appSpecific' | 'authCode' | 'password';

export const authTypeOf = (v: unknown): AuthType =>
  v === 'appSpecific' || v === 'authCode' ? v : 'password';

export interface MailAccountDraft {
  /** 编辑时带上,新增为空 */
  id: string;
  mailAddr: string;
  /** 编辑时留空保留原凭据，不在输入框回显。 */
  mailPass: string;
  /** 配置接口的原始凭据，仅用于兼容保存/检测必传密码的接口，不回显到输入框。 */
  savedCredential?: string;
  mailAcc: string;
  /** 发信名称。仅编辑可填;新增由后端按地址前缀生成 */
  mailName: string;
  sync: boolean;
  /** 同步起始时间,epoch ms */
  syncTime: number;
  reServer: string;
  rePort: number;
  reSsl: boolean;
  seServer: string;
  sePort: number;
  seSsl: boolean;
}

/** 新增时的同步起点:三个月前。老项目写死不可配,这里同样不给 UI,但至少不是硬编码常量 */
export const defaultSyncTime = (now = Date.now()) => {
  const d = new Date(now);
  d.setMonth(d.getMonth() - 3);
  return d.getTime();
};

export const emptyMailAccount = (): MailAccountDraft => ({
  id: '',
  mailAddr: '',
  mailPass: '',
  mailAcc: '',
  mailName: '',
  sync: true,
  syncTime: defaultSyncTime(),
  reServer: '',
  rePort: MAIL_PORTS.re.ssl,
  reSsl: true,
  seServer: '',
  sePort: MAIL_PORTS.se.ssl,
  seSsl: true,
});

/** `accounts-config` 的回填。注意它**不返回** `re_proto`/`se_proto`/`maid` */
export async function loadMailAccount(id: string): Promise<MailAccountDraft> {
  const d = (await postEnvelope<Record<string, unknown> | undefined>('/mails/accounts-config', {
    maid: id,
  })) as Record<string, unknown> | undefined;
  const base = emptyMailAccount();
  if (!d || !str(d.mail_addr)) throw new Error(i18n.t('ma.configMissing', { ns: 'settings' }));
  return {
    ...base,
    id,
    mailAddr: str(d.mail_addr),
    // 密码不回显:老项目回填的是一段加密占位串,再靠「长度 > 40」猜用户改没改
    mailPass: '',
    savedCredential: str(d.mail_pass) || undefined,
    mailAcc: str(d.mail_acc),
    mailName: str(d.mail_name),
    sync: bool(d.re_sync, true),
    syncTime: num(d.re_time, base.syncTime),
    reServer: str(d.re_server),
    rePort: num(d.re_port, base.rePort),
    reSsl: bool(d.re_ssl, true),
    seServer: str(d.se_server),
    sePort: num(d.se_port, base.sePort),
    seSsl: bool(d.se_ssl, true),
  };
}

/**
 * 提交体。协议是常量:后端只支持 IMAP + SMTP,老项目那个 `<Radio checked />` 没有
 * onChange/name/value,纯装饰。
 */
export function mailAccountBody(
  d: MailAccountDraft,
  extra: { skipError: boolean } | { verify: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    mail_addr: d.mailAddr.trim(),
    mail_acc: d.mailAcc.trim(),
    re_sync: d.sync,
    re_time: d.syncTime,
    re_proto: 'imap',
    re_server: d.reServer.trim(),
    re_port: d.rePort,
    re_ssl: d.reSsl,
    se_proto: 'smtp',
    se_server: d.seServer.trim(),
    se_port: d.sePort,
    se_ssl: d.seSsl,
  };
  // 新输入始终优先；编辑留空使用配置接口原样返回的凭据。
  if (d.mailPass) body.mail_pass = d.mailPass;
  else if ('verify' in extra && d.savedCredential) body.mail_pass = d.savedCredential;
  if ('verify' in extra) {
    body.verify = extra.verify;
    body.maid = d.id;
    body.mail_name = d.mailName.trim();
  } else {
    body.skip_error = extra.skipError;
    // 新增时后端按地址前缀生成发信名称,前端不给输入框
    body.mail_name = d.mailAddr.trim().split('@')[0] ?? '';
  }
  return body;
}

/** 连接测试结果。与列表的 `re_status`/`se_status` **同名不同义**:这里是布尔 */
export interface MailVerifyResult {
  /** 语义未定义,后端待确认。为真时展示错误详情 */
  check?: unknown;
  re_status?: boolean;
  se_status?: boolean;
  re_error?: string;
  se_error?: string;
  message?: string;
}

export const addMailAccount = (d: MailAccountDraft, skipError = false) =>
  postEnvelope<MailVerifyResult | undefined>(
    '/mails/accounts-add',
    mailAccountBody(d, { skipError }),
  )
    .then((r) => r ?? {})
    .catch((error: unknown) => {
      // 新增的连接失败在 success:false 的 data 中；配额、权限等其它错误仍然抛出。
      if (error instanceof AuthError && error.data && typeof error.data === 'object') {
        const result = error.data as MailVerifyResult;
        if (result.re_status === false || result.se_status === false) return result;
      }
      throw error;
    });

export async function saveMailAccount(
  d: MailAccountDraft,
  verify = true,
): Promise<MailVerifyResult> {
  const body = mailAccountBody(d, { verify: false });
  if (!body.mail_pass) throw new Error(i18n.t('ma.credentialRequired', { ns: 'settings' }));
  if (verify) {
    // accounts-save 的旧验证分支只拦“两项都失败”，单项失败也会写成正常。
    // 先独立检测，两项都通过才保存，并把此次检测状态一起写入。
    const result = await postEnvelope<MailVerifyResult | undefined>('/mails/accounts-check', body);
    if (result?.re_status === false || result?.se_status === false) return result;
    if (result?.re_status !== true || result?.se_status !== true) {
      throw new Error(i18n.t('ma.verifyIncomplete', { ns: 'settings' }));
    }
  }
  return (
    (await postEnvelope<MailVerifyResult | undefined>('/mails/accounts-save', {
      ...body,
      re_status: verify ? 'success' : 'unkown',
      se_status: verify ? 'success' : 'unkown',
      re_error: '',
      se_error: '',
    })) ?? {}
  );
}

export const deleteMailAccount = (id: string) =>
  postEnvelope<unknown>('/mails/accounts-delete', { maid: id });

/** 归属转移。展示读 `userid`,提交却叫 `owner` */
export const assignMailAccount = (id: string, owner: string) =>
  postEnvelope<unknown>('/mails/account-assign', { maid: id, owner });

/** 服务商探测结果。`data` 可能是 `{}`(未识别的服务商) */
export interface PosteConfig {
  authType?: string;
  authUrl?: string;
  mail_addr?: string;
  re_server?: string;
  re_port?: number;
  re_ssl?: boolean;
  se_server?: string;
  se_port?: number;
  se_ssl?: boolean;
}

export const probeMailConfig = (email: string) =>
  postEnvelope<PosteConfig | undefined>('/mails/accounts-poste-config', { email }).then(
    (r) => r ?? {},
  );

/** 探测结果里有没有真正可用的服务器配置 */
export const hasServerConfig = (c: PosteConfig) => !!(c.re_server && c.se_server);

/** 微软邮箱后端暂不支持。老项目只在新增时拦、且是「显示红字但照样能提交」的中间态 */
export const isMicrosoftHost = (host: string | undefined) =>
  !!host && /office365|outlook/i.test(host);

/** 帮助文档兜底地址 */
export const MAIL_DOC_URL =
  'https://doc.laifa.xin/youxiang/100-gerenyouxiang-personal-mailbox.html';

/**
 * 连接错误归因。老项目的 default 分支把文案赋给一个从未使用的局部变量后 `return null`,
 * 未知错误在链接位置什么都不显示;而且「只有发信失败」时整段直接返回 null。
 */
export type MailErrorKind = 'auth' | 'imapOff' | 'unknown';

export function mailErrorKind(msg: string | undefined): MailErrorKind {
  const v = (msg ?? '').toLowerCase();
  if (/password|passerr|login|authorization|authentication/.test(v)) return 'auth';
  if (v.includes('not enabled for imap')) return 'imapOff';
  return 'unknown';
}

/**
 * 邮箱地址。老项目正则允许 `&` 出现在本地部分的分隔位,这里保持一致 ——
 * 收紧会让存量账号改不动。
 */
export const mailAddrOk = (v: string) =>
  /^([a-z0-9]+(?:[._&-]+[a-z0-9]+)*)@([a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,})$/i.test(v.trim());

export const MAIL_PASS_MIN = 2;

/**
 * 单一校验来源。老项目按「简易屏 / 服务器配置屏」切两套不对称的 schema
 * (配置屏完全不校验地址和密码),再在 onSubmit 里补 5 条 toast 兜底。
 *
 * 返回 i18n key,由调用方 `t()`。
 */
export function validateMailAccount(
  d: MailAccountDraft,
  mode: 'add' | 'edit',
): Partial<Record<keyof MailAccountDraft, string>> {
  const e: Partial<Record<keyof MailAccountDraft, string>> = {};
  if (!d.mailAddr.trim()) e.mailAddr = 'ma.errAddrEmpty';
  else if (!mailAddrOk(d.mailAddr)) e.mailAddr = 'ma.errAddrBad';
  if (mode === 'add') {
    if (!d.mailPass) e.mailPass = 'ma.errPassEmpty';
    else if (d.mailPass.length < MAIL_PASS_MIN) e.mailPass = 'ma.errPassShort';
  } else if (d.mailPass && d.mailPass.length < MAIL_PASS_MIN) e.mailPass = 'ma.errPassShort';
  if (!d.mailAcc.trim()) e.mailAcc = 'ma.errAccEmpty';
  if (!d.reServer.trim()) e.reServer = 'ma.errReServer';
  if (!d.seServer.trim()) e.seServer = 'ma.errSeServer';
  if (!(Number.isInteger(d.rePort) && d.rePort > 0 && d.rePort < 65536)) e.rePort = 'ma.errPort';
  if (!(Number.isInteger(d.sePort) && d.sePort > 0 && d.sePort < 65536)) e.sePort = 'ma.errPort';
  return e;
}

/** 群发向导/跟进计划的账号选择器用的精简清单 */
export interface MailAccountItem {
  maid?: string;
  mail_addr?: string;
  mail_name?: string;
}
export const listMailAccounts = () =>
  postEnvelope<MailAccountItem[] | undefined>('/mailbox/account-items', {}).then((r) => r ?? []);

export const mailAccountLabel = (a: MailAccountItem) =>
  a.mail_name ? `${a.mail_addr}(${a.mail_name})` : (a.mail_addr ?? '');

/* ============================================================
   二、发信通道账号 Sender —— 平台托管的发信身份
   ============================================================ */

/** 平台共享域名池。UI 上显示成一句中文,不暴露真实域名 */
export const PUBLIC_DOMAIN = 'public';

/** 空值与 `'public'` 等价 */
export const isPublicDomain = (d: string | undefined) => !d || d === PUBLIC_DOMAIN;

export interface SenderRow {
  /** 后端读 `_id`,写 `id` */
  id: string;
  /** 发信地址的本地部分(@ 之前)。**创建后不可改** */
  name: string;
  /** 发件人显示名。唯一创建后可改的字段 */
  fromName: string;
  domain: string;
  userid: string;
  create_time: number;
}

const toSenderRow = (r: Record<string, unknown>): SenderRow => ({
  id: str(r._id),
  name: str(r.name),
  fromName: str(r.fromName),
  domain: str(r.domain, PUBLIC_DOMAIN),
  userid: str(r.userid),
  create_time: num(r.create_time),
});

export const listSenderRows = (q: ListQuery) =>
  postEnvelope<PageResult<Record<string, unknown>> | undefined>('/mailbox/sender-list', {
    current: q.current,
    pageSize: q.pageSize,
    filter: q.keyword ? { keyword: q.keyword } : {},
    sort: q.sort ?? DEFAULT_SORT,
  })
    .then(unwrapPage)
    .then((p) => ({ ...p, list: p.list.map(toSenderRow) }))
    .catch((e: Error) => {
      throw e;
    });

/** 可选域名白名单。纯字符串数组,只有域名本身,不带状态/验证信息 */
export const listSenderDomains = () =>
  postEnvelope<string[] | undefined>('/mailbox/sender-domains', {}).then((r) =>
    (r ?? []).filter((d): d is string => typeof d === 'string' && !!d),
  );

/** 重名校验。`success===false` 时 message 就是要显示的错误文案 */
export const checkSenderName = (name: string, domain: string) =>
  postEnvelope<unknown>('/mailbox/sender-check', { name, domain });

export const addSender = (v: { name: string; fromName: string; domain: string }) =>
  postEnvelope<unknown>('/mailbox/sender-add', {
    name: v.name.trim(),
    fromName: v.fromName.trim(),
    domain: v.domain,
  });

/** 保存只收 `fromName`:name 与 domain 创建后不可改,传了也会被后端丢弃 */
export const saveSender = (id: string, fromName: string) =>
  postEnvelope<unknown>('/mailbox/sender-save', { id, fromName: fromName.trim() });

/** 老项目只给了句 helperText 却没有对应正则,于是空格、中文、`@` 全能提交上去 */
export const SENDER_NAME_RE = /^[a-z0-9]+(?:\.[a-z0-9]+)*$/i;

export function validateSender(v: { name: string; fromName: string }, mode: 'add' | 'edit') {
  const e: { name?: string; fromName?: string } = {};
  if (mode === 'add') {
    if (!v.name.trim()) e.name = 'sd.errNameEmpty';
    else if (!SENDER_NAME_RE.test(v.name.trim())) e.name = 'sd.errNameBad';
  }
  if (!v.fromName.trim()) e.fromName = 'sd.errFromNameEmpty';
  return e;
}

/** 选择器用的精简清单 */
export interface SenderItem {
  _id?: string;
  name?: string;
  fromName?: string;
  domain?: string;
}
export const listSenders = () =>
  postEnvelope<SenderItem[] | undefined>('/mailbox/sender-items', {}).then((r) => r ?? []);

export const senderLabel = (s: SenderItem) =>
  isPublicDomain(s.domain) ? `${s.name}(${s.fromName})` : `${s.name}@${s.domain}(${s.fromName})`;

/* ============================================================
   三、发送时段 Schedule —— 7×24 可发送窗口
   ============================================================ */

export const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export type HourSpan = [number, number];
/** 后端下发的形状:缺席的 key = 当天不发送 */
export type TimeWindows = Partial<Record<DayKey, HourSpan[]>>;
/** 本项目内部形状:7 个 key 一个不少 */
export type FullWindows = Record<DayKey, HourSpan[]>;

export const emptyWindows = (): FullWindows =>
  Object.fromEntries(DAY_KEYS.map((d) => [d, [] as HourSpan[]])) as FullWindows;

/** 合并重叠与相邻区间,并按起点排序 */
function mergeSpans(spans: HourSpan[]): HourSpan[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: HourSpan[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * 规整成内部形状:整数小时、`[start, end)` 半开区间、`0 ≤ start < end ≤ 24`、
 * 7 个 key 写满、区间去重合并。
 *
 * **小数小时向外取整**(8.5–17 → 8–17):老项目的网格按整点 `has()` 查,
 * 后端一旦返回小数,那一天在界面上静默变成全空,用户随手一动就把原数据抹了。
 * 往外扩不会丢掉可发送时间,往里缩则可能把窗口缩成空。
 */
export function normalizeWindows(raw: TimeWindows | undefined | null): FullWindows {
  const out = emptyWindows();
  if (!raw || typeof raw !== 'object') return out;
  for (const day of DAY_KEYS) {
    const spans = (raw as Record<string, unknown>)[day];
    if (!Array.isArray(spans)) continue;
    const clean: HourSpan[] = [];
    for (const span of spans) {
      if (!Array.isArray(span) || span.length < 2) continue;
      const a = Math.max(0, Math.min(24, Math.floor(num(span[0], Number.NaN))));
      const b = Math.max(0, Math.min(24, Math.ceil(num(span[1], Number.NaN))));
      if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) continue;
      clean.push([a, b]);
    }
    out[day] = mergeSpans(clean);
  }
  return out;
}

/** 一天里被选中的整点集合,给网格用 */
export const hoursOf = (spans: HourSpan[]): Set<number> => {
  const set = new Set<number>();
  for (const [a, b] of spans) for (let h = a; h < b; h += 1) set.add(h);
  return set;
};

/** 整点集合还原成区间。相邻整点并成一段 */
export function spansOf(hours: Iterable<number>): HourSpan[] {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const out: HourSpan[] = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last && last[1] === h) last[1] = h + 1;
    else out.push([h, h + 1]);
  }
  return out;
}

/** 一周总时长(小时) */
export const windowHours = (w: FullWindows) =>
  DAY_KEYS.reduce((sum, d) => sum + w[d].reduce((s, [a, b]) => s + (b - a), 0), 0);

export const hasAnyWindow = (w: FullWindows) => DAY_KEYS.some((d) => w[d].length > 0);

/** `[8,17]` → `08:00`。小数只会来自后端脏数据,显示时把分钟也带上 */
export function hourLabel(h: number) {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export const spanLabel = ([a, b]: HourSpan) => `${hourLabel(a)}-${hourLabel(b)}`;

export interface WindowGroup {
  days: DayKey[];
  spans: HourSpan[];
}

/** 把「连续且时段完全相同」的几天并成一组,用来生成「周一至周五 08:00-17:00」 */
export function groupWindows(w: FullWindows): WindowGroup[] {
  const out: WindowGroup[] = [];
  for (const day of DAY_KEYS) {
    const spans = w[day];
    if (spans.length === 0) continue;
    const sig = spans.map(spanLabel).join(',');
    const last = out[out.length - 1];
    const prevDay = DAY_KEYS[DAY_KEYS.indexOf(day) - 1];
    const contiguous = !!last && last.days[last.days.length - 1] === prevDay;
    if (last && contiguous && last.spans.map(spanLabel).join(',') === sig) last.days.push(day);
    else out.push({ days: [day], spans });
  }
  return out;
}

export interface ScheduleRow {
  /** 后端读 `_id`,写 `id` */
  id: string;
  name: string;
  time_zone: string;
  skip_holidays: boolean;
  time_windows: FullWindows;
  isDefault: boolean;
  userid: string;
  create_time: number;
}

export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

const toScheduleRow = (r: Record<string, unknown>): ScheduleRow => ({
  id: str(r._id),
  name: str(r.name),
  time_zone: str(r.time_zone, DEFAULT_TIME_ZONE),
  skip_holidays: bool(r.skip_holidays),
  time_windows: normalizeWindows(r.time_windows as TimeWindows),
  isDefault: bool(r.isDefault),
  userid: str(r.userid),
  create_time: num(r.create_time),
});

export const listScheduleRows = (q: ListQuery) =>
  postEnvelope<PageResult<Record<string, unknown>> | undefined>(
    '/settings/sequence/schedule-list',
    {
      current: q.current,
      pageSize: q.pageSize,
      keyword: q.keyword ?? '',
      filter: {},
      sort: q.sort ?? DEFAULT_SORT,
    },
  )
    .then(unwrapPage)
    .then((p) => ({ ...p, list: p.list.map(toScheduleRow) }));

/** 跟进计划的时段选择器:一次拉满,不分页 */
export const listSchedules = () =>
  listScheduleRows({ current: 1, pageSize: 100 })
    .then((p) => p.list)
    .catch((error: unknown) => {
      if (error instanceof PermissionDeniedError || error instanceof SessionExpiredError)
        throw error;
      return emptyPage<ScheduleRow>().list;
    });

export interface ScheduleDraft {
  id: string;
  name: string;
  time_zone: string;
  skip_holidays: boolean;
  time_windows: FullWindows;
}

/** 工作日 09:00–18:00 */
export const workdayWindows = (): FullWindows => {
  const w = emptyWindows();
  for (const d of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const) {
    w[d] = [[9, 18]];
  }
  return w;
};

export const emptySchedule = (): ScheduleDraft => ({
  id: '',
  name: '',
  time_zone: DEFAULT_TIME_ZONE,
  // 老项目新增弹窗的 type 与 schema 里都没有 time_windows,靠 yup 不剥离未知字段
  // 才侥幸提交上去 —— 换成会剥离的校验器就会整包丢失。这里显式带上
  skip_holidays: false,
  time_windows: workdayWindows(),
});

export const draftFromSchedule = (r: ScheduleRow): ScheduleDraft => ({
  id: r.id,
  name: r.name,
  time_zone: r.time_zone || DEFAULT_TIME_ZONE,
  skip_holidays: r.skip_holidays,
  time_windows: normalizeWindows(r.time_windows),
});

/** 提交体。`time_windows` 永远写满 7 个 key,不让 key 集合随「有没有动过网格」漂移 */
export const scheduleBody = (d: ScheduleDraft): Record<string, unknown> => ({
  name: d.name.trim(),
  time_zone: d.time_zone,
  skip_holidays: d.skip_holidays,
  time_windows: normalizeWindows(d.time_windows),
});

export const addSchedule = (d: ScheduleDraft) =>
  postEnvelope<unknown>('/settings/sequence/schedule-add', scheduleBody(d));

export const saveSchedule = (d: ScheduleDraft) =>
  postEnvelope<unknown>('/settings/sequence/schedule-save', { ...scheduleBody(d), id: d.id });

export const deleteSchedule = (id: string) =>
  postEnvelope<unknown>('/settings/sequence/schedule-delete', { id });

/** 单向「设为默认」:后端保证互斥,没有「取消默认」这个动作 */
export const setDefaultSchedule = (id: string) =>
  postEnvelope<unknown>('/settings/sequence/schedule-default', { id });

export function validateSchedule(d: ScheduleDraft) {
  const e: { name?: string; time_zone?: string; time_windows?: string } = {};
  if (!d.name.trim()) e.name = 'sc.errNameEmpty';
  if (!d.time_zone) e.time_zone = 'sc.errTzEmpty';
  // 老项目这条校验形同虚设:`{}` 和「7 个空数组」都能过 yup 的 object().required()
  if (!hasAnyWindow(d.time_windows)) e.time_windows = 'sc.errWindowEmpty';
  return e;
}

/**
 * 时区白名单。老项目把 UTC 偏移写死在文案里(悉尼恒显示 +10:00),夏令时一到就错;
 * 这里只存 IANA id,偏移在运行时算。
 */
export const TIME_ZONES = [
  'Pacific/Midway',
  'Pacific/Honolulu',
  'America/Juneau',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/La_Paz',
  'America/St_Johns',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Athens',
  'Asia/Tehran',
  'Asia/Muscat',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Darwin',
  'Australia/Sydney',
  'Asia/Vladivostok',
  'Pacific/Auckland',
] as const;

/** 该时区此刻相对 UTC 的分钟数。不支持的 id 返回 null */
export function tzOffsetMinutes(tz: string, at: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    }).formatToParts(at);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (name === 'GMT' || name === 'UTC') return 0;
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    return null;
  }
}

/** `+08:00` / `-03:30` */
export function tzOffsetLabel(tz: string, at?: Date) {
  const mins = tzOffsetMinutes(tz, at);
  if (mins === null) return '';
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * 时区差(小时,可为小数)。用来把窗口里的小时换算成本地时间对照。
 * 印度、伊朗这些半时区会给出 .5 / .75。
 */
export function tzHourShift(from: string, to: string, at?: Date): number | null {
  const a = tzOffsetMinutes(from, at);
  const b = tzOffsetMinutes(to, at);
  if (a === null || b === null) return null;
  return (b - a) / 60;
}

/** 浏览器所在时区,拿不到时回落到默认 */
export const localTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
};
