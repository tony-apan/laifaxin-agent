import { postEnvelope } from '@/api/auth';

/**
 * 设置 · 黑名单。一条记录就是一个 `domain` 字符串 —— **域名和邮箱共用这一个字段**,
 * 后端没有类型标记,`kind` 是这一层按有没有 `@` 推出来的。
 *
 * 与老项目的差异:
 * - **解析管线重写**。老项目:整段文本里只要出现一个 `名字 <a@b.com>` 形式,
 *   所有邮箱就改走另一条正则、把 `名字 <a@b.com>` 整串当成邮箱提交;域名转小写并
 *   全局删掉 `www.`(`wwww.foo.com` 也会被削);「联系 a@x.com 请回复」这一行会
 *   **同时**提交邮箱和整个域名,用户以为只拉黑了一个人;全程没有去重。
 * - **`types` 不再用 localStorage 记忆**。老项目编辑某一行时会拿上次新增用的
 *   类型盖掉这一行的真实值 —— 点开改个备注就顺手把生效范围改了。
 * - **批量修改支持只改类型不动备注**(不下发 comment 字段)。老项目留空即清空,
 *   且没有任何提示。
 * - **单条编辑与批量修改也校验「至少选一个类型」**(老项目那行 `min(1)` 被注释掉了,
 *   于是能把选中条目的类型全部清空)。
 */

/** 生效场景。`'all'` 只是筛选层的伪值,**永远不进数据** */
export const BLACK_TYPES = ['search', 'send'] as const;
export type BlackType = (typeof BLACK_TYPES)[number];

export type BlackFilter = BlackType | 'all';

export interface BlackRow {
  id: string;
  /** 域名或邮箱原文 */
  domain: string;
  /** 有 `@` 就是邮箱。后端没有这个字段,是这一层推的 */
  kind: 'email' | 'domain';
  types: BlackType[];
  comment: string;
  userid: string;
  create_time: number;
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

const toTypes = (v: unknown): BlackType[] =>
  Array.isArray(v) ? v.filter((x): x is BlackType => x === 'search' || x === 'send') : [];

const toRow = (r: Record<string, unknown>): BlackRow => {
  const domain = str(r.domain);
  return {
    id: str(r._id),
    domain,
    kind: domain.includes('@') ? 'email' : 'domain',
    types: toTypes(r.types),
    // 后端会回 null
    comment: str(r.comment),
    userid: str(r.userid),
    create_time: num(r.create_time),
  };
};

/* ---------- 勾选口径 ---------- */

/** 与客户管理批量操作同一套语义:当前页 / 前 N 条 / 命中筛选的全部 */
export type SelectOption = 'current' | 'front' | 'all';

export interface BlackScope {
  selectKeys: string[];
  selectOption: SelectOption;
  selectTotal: number;
  filter: BlackFilter;
  keyword: string;
  sort: Record<string, 1 | -1>;
}

export const DEFAULT_BLACK_SORT: Record<string, 1 | -1> = { create_time: -1 };

/** `'all'` 归一成空对象。老项目三个调用点两套做法,批删那处漏了 */
const wireFilter = (f: BlackFilter) => (f === 'all' ? {} : { types: f });

/** 后端按 selectOption 分支:current 用 selectKeys,front/all 必须用 filter+keyword 重新圈定 */
const scopeBody = (s: BlackScope) => ({
  selectKeys: s.selectOption === 'current' ? s.selectKeys : [],
  selectOption: s.selectOption,
  selectTotal: s.selectTotal,
  filter: wireFilter(s.filter),
  keyword: s.keyword.trim().toLowerCase(),
  selectSort: s.sort,
});

/* ---------- 读 ---------- */

export interface BlackQuery {
  current: number;
  pageSize: number;
  filter: BlackFilter;
  keyword: string;
  sort: Record<string, 1 | -1>;
}

export const listBlacks = (q: BlackQuery) =>
  postEnvelope<{ current?: number; total?: number; list?: Record<string, unknown>[] } | undefined>(
    '/contacts/black/domains-list',
    {
      current: q.current,
      pageSize: q.pageSize,
      filter: wireFilter(q.filter),
      sort: q.sort,
      // 小写化放在请求层,不回写输入框 —— 老项目 setState 时就转,用户打大写会看到字母变小写
      keyword: q.keyword.trim().toLowerCase(),
    },
  ).then((r) => ({
    list: (r?.list ?? []).map(toRow),
    total: num(r?.total),
    current: num(r?.current, q.current),
  }));

export interface BlackCounts {
  search: number;
  send: number;
  total: number;
}

/** 全局计数,不受 filter/keyword 影响 */
export const blackCounts = () =>
  postEnvelope<Partial<BlackCounts> | undefined>('/contacts/black/domains-count', {}).then((r) => ({
    search: num(r?.search),
    send: num(r?.send),
    total: num(r?.total),
  }));

/* ---------- 写 ---------- */

export const addBlacks = (v: { domains: string[]; types: BlackType[]; comment: string }) =>
  postEnvelope<{ saved?: number } | undefined>('/contacts/black/domains-save', {
    domains: v.domains,
    types: v.types,
    comment: v.comment,
  }).then((r) => num(r?.saved));

/** 单条保存。老项目从表格开关切换时不带 `_id`,后端只能靠 domain 认人 */
export const saveBlack = (v: { id: string; domain: string; types: BlackType[]; comment: string }) =>
  postEnvelope<unknown>('/contacts/black/domain-save', {
    _id: v.id,
    domain: v.domain,
    types: v.types,
    comment: v.comment,
  });

/** 批量修改。`comment` 为 undefined 表示不动备注 —— 老项目留空即清空且无提示 */
export const updateBlacks = (scope: BlackScope, v: { types: BlackType[]; comment?: string }) =>
  postEnvelope<unknown>('/contacts/black/domains-update', {
    ...scopeBody(scope),
    types: v.types,
    ...(v.comment === undefined ? {} : { comment: v.comment }),
  });

/** 批量与单条删除走同一个请求体形状。老项目单删只发两个字段 */
export const deleteBlacks = (scope: BlackScope) =>
  postEnvelope<unknown>('/contacts/black/domains-delete', scopeBody(scope));

export type ExportFields = 'all' | 'part';

/** 老项目这里是 `{...整个 state}` 展开,连 page/rowCount 都发出去了 */
export const exportBlacks = (scope: BlackScope, fieldType: ExportFields) =>
  postEnvelope<unknown>('/contacts/black/domains-export', {
    ...scopeBody(scope),
    exportType: 'csv',
    fieldType,
  });

/* ---------- 批量粘贴的解析 ---------- */

/**
 * 邮箱。整段文本里捞,所以 `张三 <a@b.com>` 也能抽出裸邮箱 ——
 * 老项目这种情况会把 `张三 <a@b.com>` 整串当成邮箱提交上去。
 */
const EMAIL_RE =
  /[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi;

/** 域名。跑在**剔掉邮箱之后**的剩余文本上 */
const DOMAIN_RE = /(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/gi;

export interface ParsedBlacks {
  emails: string[];
  domains: string[];
}

const dedupe = (xs: string[]) => [...new Set(xs)];

/**
 * 把一段随手粘贴的文本解析成邮箱与域名两组。
 *
 * 规则(与老项目的差异都在这):
 * - 邮箱先抽,抽走之后剩下的文本才找域名 —— 所以「联系 a@x.com 请回复」
 *   只产出 `a@x.com`,不会顺带把 `x.com` 也拉黑
 * - 邮箱与域名**一律转小写**(老项目只对域名转,`B@X.COM` 与 `b@x.com` 会存成两条)
 * - `www.` **只削开头**(老项目全局 replace,`wwww.foo.com` 会被削成 `wfoo.com`)
 * - 两组各自去重(老项目全程没有 Set,粘两遍同一个域名就提交两条)
 */
export function parseBlacks(text: string): ParsedBlacks {
  const emails = dedupe(
    [...text.matchAll(EMAIL_RE)]
      .filter((match) => {
        const before = text[(match.index ?? 0) - 1] ?? '';
        const after = text[(match.index ?? 0) + match[0].length] ?? '';
        return (
          !/[a-z0-9._%+@-]/i.test(before) &&
          !/[a-z0-9_%+@-]/i.test(after) &&
          !match[0].split('@')[0].includes('..')
        );
      })
      .map((match) => match[0].toLowerCase()),
  );
  // 先把邮箱从文本里抠掉,剩下的才找域名 —— 这一步就够了:
  // 邮箱自己的域名不会被再抽一遍,而用户单独写的域名照样留着,
  // 哪怕它恰好和某个邮箱同域(那是两条不同的意图,不能替用户合并)
  const rest = text.replace(/[^\s,;<>]*@[^\s,;<>]*/g, ' ');
  const domains = dedupe(
    (rest.match(DOMAIN_RE) ?? []).map((v) => v.toLowerCase().replace(/^www\./, '')),
  );
  return { emails, domains };
}

export const parsedTotal = (p: ParsedBlacks) => p.emails.length + p.domains.length;

/** 提交给后端的是一个混合数组:邮箱在前、域名在后 */
export const parsedList = (p: ParsedBlacks) => [...p.emails, ...p.domains];

/* ---------- 校验 ---------- */

export function validateBlackAdd(v: { text: string; types: BlackType[] }) {
  const e: { text?: string; types?: string } = {};
  if (v.types.length === 0) e.types = 'bl.errTypesEmpty';
  if (!v.text.trim()) e.text = 'bl.errTextEmpty';
  else if (parsedTotal(parseBlacks(v.text)) === 0) e.text = 'bl.errTextBad';
  return e;
}

/** 单条编辑与批量修改共用。老项目这两处把 `min(1)` 注释掉了 */
export function validateBlackTypes(types: BlackType[]) {
  return types.length === 0 ? { types: 'bl.errTypesEmpty' } : {};
}

/** 切换某个类型的开/关,对 undefined 有保护 —— 老项目直接展开,types 缺失就抛 */
export const toggleBlackType = (
  types: BlackType[] | undefined,
  t: BlackType,
  on: boolean,
): BlackType[] => (on ? [...new Set([...(types ?? []), t])] : (types ?? []).filter((x) => x !== t));
