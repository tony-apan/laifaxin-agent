import i18n from 'i18next';
import { postEnvelope } from '@/api/auth';
import type { PageResult } from '@/api/expenses';

/**
 * 设置 · 内容三件套:邮件模板 / 常用短语 / 邮件签名。
 *
 * 三页在老项目里是各写各的,同一件事有三套写法。这里按一套口径收敛,
 * 逐条记下与老项目的差异,免得联调时以为是新写的 bug:
 *
 * - **主键读写同名 `id`**。老项目行上是 `_id`、请求体是 `id`,而目录保存又传 `foid`、
 *   旧模板接口传 `_id` —— 同一个概念四个名字。这里对外一律 `id`,拆包时统一。
 * - **目录只有一层**,而且和内容混在同一张分页表里,靠 `folder: true` 区分。
 *   点目录 = 带 `foid` 重新请求(服务端下钻),前端不建树。
 * - **哨兵目录 `'0'`** 表示「未归目录」。老项目筛选栏叫「未指定目录」、下拉里叫
 *   「不指定目录」,两个词指同一个东西,这里统一。
 * - **正文字段名不统一**:模板和短语是 `html`,签名是 `content`。这是后端定的,
 *   没法在前端抹平,类型上显式标出来。
 */

/* ---------- 公共 ---------- */

/** 未归目录。目录 id 用它表示「不在任何目录下」 */
export const ROOT_FOLDER = '0';

export interface FolderItem {
  id: string;
  name: string;
  /** 创建者 userid,模板目录才有 */
  userid?: string;
}

/** 目录与内容混在同一张表里,靠 folder 区分 */
export interface ContentRowBase {
  id: string;
  folder: boolean;
  name: string;
  foid: string;
  userid?: string;
  create_time?: number;
  update_time?: number;
}

export interface ListQuery {
  current: number;
  pageSize: number;
  keyword: string;
  /** 目录 id;ROOT_FOLDER 表示未归目录那一层 */
  foid: string;
  sort: Record<string, 1 | -1>;
}

/** 接口回的是 `_id`,对外统一成 `id` */
const withId = <T extends { _id?: string }>(row: T): Omit<T, '_id'> & { id: string } => {
  const { _id, ...rest } = row;
  return { ...rest, id: _id ?? '' };
};

const unwrapList = <T extends { _id?: string }>(r: PageResult<T> | undefined) => ({
  list: (r?.list ?? []).map(withId),
  total: r?.total ?? 0,
  current: r?.current ?? 1,
});

const unwrapFolders = (r: { _id?: string; name?: string; userid?: string }[] | undefined) =>
  (r ?? []).map((f) => ({ id: f._id ?? '', name: f.name ?? '', userid: f.userid }));

/* ---------- 邮件模板 ---------- */

/**
 * 归属筛选。**后端筛**(列表接口收 owner 参数)——
 * 老项目的模板树选择器是前端筛的,还把 team 实现成「不是我的」,别照抄那套。
 */
export const TEMPLATE_OWNERS = ['everyone', 'mine', 'team'] as const;
export type TemplateOwner = (typeof TEMPLATE_OWNERS)[number];

/**
 * 行级权限。老项目代码里只出现过 'admin' 和 'edit' 两个字面量,
 * 第三档叫什么没有证据 —— 所以只按两条规则判,其余一律当只读。
 */
export type RowAuth = string;
export const canEditRow = (auth?: RowAuth) => auth === 'admin' || auth === 'edit';
export const canDeleteRow = (auth?: RowAuth) => auth === 'admin';

/** 共享:所有人一档,指定成员/部门各一档。成员/部门那两档没有「不可见」 */
export const EVERYONE_AUTHS = ['none', 'read', 'edit'] as const;
export type EveryoneAuth = (typeof EVERYONE_AUTHS)[number];
export const SHARE_AUTHS = ['read', 'edit'] as const;
export type ShareAuth = (typeof SHARE_AUTHS)[number];

export interface ShareSettings {
  everyoneAuth: EveryoneAuth;
  /** 成员的 userid,不是 _id */
  sharedUsers: string[];
  /** 部门的 team_id */
  sharedTeams: string[];
  usersAuth: ShareAuth;
  teamsAuth: ShareAuth;
}

export const DEFAULT_SHARE: ShareSettings = {
  everyoneAuth: 'none',
  sharedUsers: [],
  sharedTeams: [],
  usersAuth: 'read',
  teamsAuth: 'read',
};

export interface TemplateRow extends ContentRowBase, Partial<ShareSettings> {
  subject?: string;
  /** 列表**不保证**返回正文 —— 要正文走 getTemplateHtml */
  html?: string;
  auth?: RowAuth;
  /** 垃圾邮件指数,越低越好。undefined 表示还没评过 */
  spamScore?: number;
  /** 被某个跟进计划占用时才有 */
  seqData?: { seqId?: string; seqName?: string };
}

/**
 * ⚠️ `foid` 空串与「不传」是两回事:**不传 = 全部模板**,传了才下钻到那一层
 * (而 `'0'` 是「未归目录」这一层,也不是「全部」)。写信的模板选择器要的是全部,
 * 所以空串在这里整个键都不发 —— 发出去会被当成「foid 等于空串的那个目录」,
 * 结果是一条都查不到。
 */
export const listTemplates = (q: ListQuery & { owner: TemplateOwner; templatesOnly?: boolean }) =>
  postEnvelope<PageResult<TemplateRow & { _id?: string }> | undefined>('/mailbox/templates-list', {
    current: q.current,
    pageSize: q.pageSize,
    filter: q.templatesOnly ? { folder: { $ne: true } } : {},
    sort: q.sort,
    keyword: q.keyword,
    ...(q.foid ? { foid: q.foid } : {}),
    owner: q.owner,
  }).then(unwrapList);

export const listTemplateFolders = () =>
  postEnvelope<{ _id?: string; name?: string; userid?: string }[] | undefined>(
    '/mailbox/templates-folder-list',
    {},
  ).then(unwrapFolders);

/**
 * 新建目录。**要求后端回新目录的 id** —— 老项目不回,前端只好按名字反查,
 * 查不到就 `undefined._id` 抛错、重名还会选错目录。
 */
export const addTemplateFolder = (name: string) =>
  postEnvelope<{ id?: string; _id?: string } | undefined>('/mailbox/template-folder-add', {
    name,
  }).then((r) => r?.id ?? r?._id ?? '');

export const saveTemplateFolder = (id: string, name: string) =>
  postEnvelope<unknown>('/mailbox/template-folder-save', { id, name });

export const deleteTemplateFolder = (id: string) =>
  postEnvelope<unknown>('/mailbox/template-folder-delete', { id });

export interface TemplateDraft extends ShareSettings {
  id?: string;
  name: string;
  subject: string;
  html: string;
  foid: string;
}

export const EMPTY_TEMPLATE = (foid: string): TemplateDraft => ({
  name: '',
  subject: '',
  html: '',
  foid,
  ...DEFAULT_SHARE,
});

const templateBody = (d: TemplateDraft) => ({
  name: d.name.trim(),
  subject: d.subject.trim(),
  html: d.html,
  foid: d.foid,
  everyoneAuth: d.everyoneAuth,
  sharedUsers: d.sharedUsers,
  sharedTeams: d.sharedTeams,
  usersAuth: d.usersAuth,
  teamsAuth: d.teamsAuth,
});

export const addTemplate = (d: TemplateDraft) =>
  postEnvelope<{ id?: string } | undefined>('/mailbox/template-add', templateBody(d));

export const saveTemplate = (d: TemplateDraft) =>
  postEnvelope<unknown>('/mailbox/template-save', { ...templateBody(d), id: d.id });

/** 缺失详情不是空模板；不能把加载失败当成可保存的空正文。 */
export const getTemplate = (id: string) =>
  postEnvelope<(Partial<TemplateRow> & Partial<ComposeTemplate>) | null | undefined>(
    '/mailbox/template-info',
    { id },
  ).then((row) => {
    if (!row || row.folder || typeof row.html !== 'string') {
      throw new Error(i18n.t('content:tpl.unavailable'));
    }
    return { ...row, html: row.html };
  });

export const getTemplateHtml = (id: string) => getTemplate(id).then((row) => row.html);

export const deleteTemplate = (id: string) =>
  postEnvelope<unknown>('/mailbox/template-delete', { id });

export const deleteTemplates = (ids: string[]) =>
  postEnvelope<unknown>('/mailbox/templates-delete', { ids });

/** 同一个接口两种用法:改目录、改共享 */
export const moveTemplates = (ids: string[], foid: string) =>
  postEnvelope<unknown>('/mailbox/templates-update', { ids, foid });

export const shareTemplates = (ids: string[], share: ShareSettings) =>
  postEnvelope<unknown>('/mailbox/templates-update', { ids, ...share });

export interface SpamResult {
  spamScore?: number;
  spamList?: { phrase?: string; score?: number }[];
}
export const scoreTemplate = (body: { id?: string; html?: string }) =>
  postEnvelope<SpamResult | undefined>('/mailbox/template-score', body);

/** 垃圾邮件指数分档。分越低越好 */
export function spamLevel(score: number): 'perfect' | 'good' | 'fair' | 'poor' | 'bad' {
  if (score === 0) return 'perfect';
  if (score <= 5) return 'good';
  if (score <= 10) return 'fair';
  if (score <= 15) return 'poor';
  return 'bad';
}

/* ---------- 变量占位符 ---------- */

/**
 * 模板里的变量。主题是纯文本占位符,正文是带类名的 code 元素 ——
 * 两种形态不对称,后端替换逻辑也是分开写的。
 *
 * 与旧项目及服务端 getContentVeriable 保持一致，冒号后使用字段 title。
 * 服务端按 title 查找 dataIndex，直接写入 dataIndex 无法识别为变量。
 * 类名 `lfxFieldVeriable` 拼写是错的,但存量模板里就是这个,不能改。
 */
export const VARIABLE_CLS = 'lfxFieldVeriable';

export type VariableScope = 'contact' | 'company';

export const variableToken = (scope: VariableScope, title: string) =>
  `{${scope === 'company' ? '公司' : '联系人'}:${title}}`;

export const variableHtml = (scope: VariableScope, title: string) => {
  const token = variableToken(scope, title)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<code class="${VARIABLE_CLS}" contenteditable="false">${token}</code>`;
};

/** 只认这两个前缀 —— 用户手打的 {价格:100} 不该被当成变量 */
export const VARIABLE_RE = /\{(?:联系人|公司):[^}]+\}/g;

/* ---------- 常用短语 ---------- */

export interface SnippetRow extends ContentRowBase {
  /** 短语正文,HTML */
  html?: string;
}

export const listSnippets = (q: ListQuery) =>
  postEnvelope<PageResult<SnippetRow & { _id?: string }> | undefined>('/mailbox/snippets-list', {
    current: q.current,
    pageSize: q.pageSize,
    // 常用语接口从 filter 读取归属和目录；0 表示不按目录筛选。
    filter: { owner: 'mine', foid: q.foid },
    sort: q.sort,
    keyword: q.keyword,
  }).then(unwrapList);

export const listSnippetFolders = () =>
  postEnvelope<{ _id?: string; name?: string }[] | undefined>('/mailbox/snippets-folder-list', {
    owner: 'mine',
  }).then(unwrapFolders);

export const addSnippetFolder = (name: string) =>
  postEnvelope<{ id?: string; _id?: string } | undefined>('/mailbox/snippets-folder-add', {
    name,
  }).then((r) => r?.id ?? r?._id ?? '');

export const saveSnippetFolder = (id: string, name: string) =>
  postEnvelope<unknown>('/mailbox/snippets-folder-save', { id, name });

export const deleteSnippetFolder = (id: string) =>
  postEnvelope<unknown>('/mailbox/snippets-folder-delete', { id });

export interface SnippetDraft {
  id?: string;
  name: string;
  html: string;
  foid: string;
}

export const addSnippet = (d: SnippetDraft) =>
  postEnvelope<unknown>('/mailbox/snippets-content-add', {
    name: d.name.trim(),
    foid: d.foid,
    html: d.html,
  });

export const saveSnippet = (d: SnippetDraft) =>
  postEnvelope<unknown>('/mailbox/snippets-content-save', {
    name: d.name.trim(),
    foid: d.foid,
    html: d.html,
    id: d.id,
  });

export const deleteSnippet = (id: string) =>
  postEnvelope<unknown>('/mailbox/snippets-content-delete', { id });

export const deleteSnippets = (ids: string[]) =>
  postEnvelope<unknown>('/mailbox/snippets-delete', { ids });

export const moveSnippets = (ids: string[], foid: string) =>
  postEnvelope<unknown>('/mailbox/snippets-move', { ids, foid });

/* ---------- 邮件签名 ---------- */

/**
 * 签名没有目录,是一张平表。
 * **正文字段叫 `content`,不是 html** —— 与模板/短语不一致,后端定的。
 */
export interface SignatureRow {
  id: string;
  name: string;
  content?: string;
  /** 写新邮件时默认带出 */
  forNew?: boolean;
  /** 回复/转发时默认带出 */
  forReply?: boolean;
}

export const listSignatures = (q: { current: number; pageSize: number }) =>
  postEnvelope<PageResult<SignatureRow & { _id?: string }> | undefined>('/mailbox/sign-list', {
    current: q.current,
    pageSize: q.pageSize,
    sort: {},
    filter: {},
  }).then(unwrapList);

/** 写信需要完整签名列表，默认签名可能在第 100 条之后。 */
export async function listComposeSignatures(): Promise<SignatureRow[]> {
  const rows = new Map<string, SignatureRow>();
  for (let current = 1; ; current++) {
    const page = await listSignatures({ current, pageSize: 100 });
    for (const row of page.list) rows.set(row.id, row);
    if (page.list.length === 0 || current * 100 >= page.total) return [...rows.values()];
  }
}

export interface SignatureDraft {
  id?: string;
  name: string;
  content: string;
  forNew: boolean;
  forReply: boolean;
}

const signBody = (d: SignatureDraft) => ({
  name: d.name.trim(),
  content: d.content,
  // 老项目在编辑态下这两个可能是 undefined,原样发给后端;这里兜成布尔
  forNew: !!d.forNew,
  forReply: !!d.forReply,
});

export const addSignature = (d: SignatureDraft) =>
  postEnvelope<unknown>('/mailbox/sign-add', signBody(d));

export const saveSignature = (d: SignatureDraft) =>
  postEnvelope<unknown>('/mailbox/sign-save', { ...signBody(d), id: d.id });

export const deleteSignature = (id: string) =>
  postEnvelope<unknown>('/mailbox/sign-delete', { id });

/** 设置/取消某个默认位。value=false 就是取消 */
export const setSignatureDefault = (id: string, type: 'new' | 'reply', value: boolean) =>
  postEnvelope<unknown>('/mailbox/sign-default-set', { id, type, value });

/* ---------- 成员与部门(共享设置用) ---------- */

export interface OrgUser {
  userid: string;
  nickname?: string;
  avatar?: string;
  role_name?: string;
  /** 就是当前登录的人 */
  myself?: boolean;
}
export const listOrgUsers = () =>
  postEnvelope<OrgUser[] | undefined>('/enterprise/organize-users', {}).then((r) => r ?? []);

export interface OrgTeam {
  team_id: string;
  team_name?: string;
  father?: string;
}
export const listOrgTeams = () =>
  postEnvelope<OrgTeam[] | undefined>('/enterprise/teams-list', {}).then((r) => r ?? []);

/** 找不到人时回落到 userid,再没有才显示占位 —— 老项目这里不兜底,昵称为空直接崩 */
export const userLabel = (u: OrgUser | undefined, id: string, fallback: string) =>
  u?.nickname?.trim() || id || fallback;

/* ---------- 可用变量字段 ---------- */

export interface FieldOption {
  title: string;
  dataIndex: string;
  valueType?: string;
}
export const listContactFields = () =>
  postEnvelope<FieldOption[] | undefined>('/fields/contacts-fields', {
    belongTo: 'contact',
    saveType: 'read',
  }).then((r) => r ?? []);

export const listCompanyFields = () =>
  postEnvelope<FieldOption[] | undefined>('/fields/company-fields', {
    belongTo: 'company',
    saveType: 'read',
  }).then((r) => r ?? []);

/* ---------- 写信面板要用的两个 ---------- */

export interface ComposeTemplate {
  html: string;
  subject: string;
  /** 正文里用到的变量。写信不做变量替换,要把它们剥掉 */
  veriables?: string[];
  /** 主题里用到的变量 */
  subjectVeriables?: string[];
}

/** 写信与管理共用带权限检查的详情，主题和正文来自同一份最新数据。 */
export const getComposeTemplate = (id: string) =>
  getTemplate(id).then(
    (d): ComposeTemplate => ({
      html: d.html,
      subject: d.subject ?? '',
      veriables: Array.isArray(d.veriables) ? d.veriables : [],
      subjectVeriables: Array.isArray(d.subjectVeriables) ? d.subjectVeriables : [],
    }),
  );

/**
 * 把模板里的变量占位剥干净。
 *
 * 正文里变量是包在 `<code class="lfxFieldVeriable">` 里的整段,连标签一起去掉;
 * 主题里是裸的 `{联系人:xxx}` 文本。
 *
 * ⚠️ 类名 `lfxFieldVeriable` 拼错了(veriable),但存量模板全是这个,**不能改**。
 */
export function stripVariables(html: string): string {
  return html
    .replace(new RegExp(`<code[^>]*class="[^"]*${VARIABLE_CLS}[^"]*"[^>]*>.*?</code>`, 'gi'), '')
    .replace(VARIABLE_RE, '');
}

export interface SnippetText {
  id: string;
  name: string;
  html: string;
}

/**
 * 写信的片段菜单。**扁平不分页** —— 与设置页那个分页的 `listSnippets` 不是一个接口。
 */
export const listSnippetTexts = () =>
  postEnvelope<(SnippetText & { _id?: string })[] | undefined>(
    '/mailbox/snippets-text-list',
    {},
  ).then((r) =>
    (r ?? []).map((x) => ({ id: x.id ?? x._id ?? '', name: x.name ?? '', html: x.html ?? '' })),
  );
