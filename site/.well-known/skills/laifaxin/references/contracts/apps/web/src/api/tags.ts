import { normalizeTag, type TagItem, type TagType } from '@laifaxin/core/tags';

export { TAG_TYPES, type TagItem, type TagType } from '@laifaxin/core/tags';

import { postEnvelope } from '@/api/auth';

/** 设置页管理的五种 */
export const MANAGED_TAG_TYPES = ['contacts', 'company', 'phone', 'extMap', 'clues'] as const;

export type ManagedTagType = (typeof MANAGED_TAG_TYPES)[number];

/** 顶级/未归目录的哨兵。老项目对它有「默认目录 / 顶级目录 / 未指定目录」三个叫法 */
export const ROOT_DIR = '0';

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

export const listTags = (type: TagType) =>
  postEnvelope<Record<string, unknown>[] | undefined>('/contacts/tags-list', { type }).then((r) =>
    (r ?? []).map(normalizeTag),
  );

/* ---------- 增删改 ---------- */

export interface TagDraft {
  id: string;
  name: string;
  color: string;
  parent: string;
  description: string;
}

export const emptyTag = (parent = ROOT_DIR, color = randomTagColor()): TagDraft => ({
  id: '',
  name: '',
  color,
  parent,
  description: '',
});

export const draftFromTag = (t: TagItem): TagDraft => ({
  id: t.id,
  name: t.name,
  // 老数据可能没存颜色,编辑时给一个,免得被「颜色必填」卡住又看不出该选什么
  color: t.color || randomTagColor(t.id),
  parent: t.parent,
  description: t.description,
});

/** 回新建标签的 id —— 选择器里随手建一个之后要立刻选上 */
export const addTag = (type: TagType, d: TagDraft) =>
  postEnvelope<{ id?: string } | undefined>('/contacts/tags-add', {
    type,
    name: d.name.trim(),
    color: d.color,
    parent: d.parent,
    description: d.description,
  });

export const saveTag = (type: TagType, d: TagDraft) =>
  postEnvelope<unknown>('/contacts/tags-save', {
    type,
    id: d.id,
    name: d.name.trim(),
    color: d.color,
    parent: d.parent,
    description: d.description,
  });

export interface FolderDraft {
  id: string;
  name: string;
  description: string;
}

export const emptyFolder = (): FolderDraft => ({ id: '', name: '', description: '' });

/** 建目录的请求体里没有 parent —— 后端只支持一层 */
export const addTagFolder = (type: TagType, d: FolderDraft) =>
  postEnvelope<unknown>('/contacts/tags-dir-add', {
    type,
    name: d.name.trim(),
    description: d.description,
  });

/** 保存目录复用 tags-save,但不带 color/parent */
export const saveTagFolder = (type: TagType, d: FolderDraft) =>
  postEnvelope<unknown>('/contacts/tags-save', {
    type,
    id: d.id,
    name: d.name.trim(),
    description: d.description,
  });

/** 单删。目录与标签共用这条,`type` 是本项目补的 —— 老项目一个判别信息都不传 */
export const deleteTag = (type: TagType, id: string) =>
  postEnvelope<unknown>('/settings/tags/contact-delete', { id, type });

/** 批删。注意路径比单删少一层 `/tags/`,不是笔误 */
export const deleteTags = (type: TagType, ids: string[]) =>
  postEnvelope<unknown>('/settings/tags-delete', { ids, type });

/* ---------- 排序与换目录 ---------- */

/**
 * 同层排序:`dirId` 是这些标签所在的目录,`ids` **只含该目录内的标签**。
 * 老项目发的是「当前视图的全部行 id」,目录混在里面。
 */
export const sortTags = (dirId: string, tagIds: string[]) =>
  postEnvelope<unknown>('/contacts/tags-sort', { dirId, ids: tagIds });

/** 目录之间排序。请求体只有 ids */
export const sortTagFolders = (folderIds: string[]) =>
  postEnvelope<unknown>('/contacts/tags-dirs-sort', { ids: folderIds });

/**
 * 换目录。后端语义是「dirId 这个目录移动后的全量标签」,所以要先算出目标目录的新成员。
 * 排除目录行 —— `toDir === ROOT_DIR` 时目录自身的 parent 也是 `'0'`,
 * 老项目在这里会把所有顶级目录的 id 一起提交上去。
 */
export function tagsAfterMove(all: TagItem[], toDir: string, moving: string[]): string[] {
  const move = new Set(moving);
  const stay = all
    .filter((t) => !t.folder && t.parent === toDir && !move.has(t.id))
    .map((t) => t.id);
  // 被移动的追加在末尾,与老项目一致;去重后再拼,避免目标目录里已有同一 id
  return [...stay, ...moving];
}

export const moveTags = (toDir: string, idsInTarget: string[]) =>
  postEnvelope<unknown>('/contacts/tags-sort', { dirId: toDir, ids: idsInTarget });

/* ---------- 统计 ---------- */

/** 当前类型的全量统计，由标签管理页的「统计」按钮手动触发。 */
export const tagStats = (type: TagType) =>
  postEnvelope<{ id?: string; parent?: string; count?: number }[] | undefined>(
    '/contacts/tags-all-stats',
    { type },
  ).then((r) => {
    const map = new Map<string, number>();
    for (const s of r ?? []) if (s.id) map.set(s.id, num(s.count));
    return map;
  });

export const tagStatOne = (type: TagType, id: string) =>
  postEnvelope<{ count?: number } | undefined>('/contacts/tags-one-stats', { type, id }).then((r) =>
    num(r?.count),
  );

export const tagStatSome = (type: TagType, ids: string[]) =>
  postEnvelope<{ count?: number }[] | undefined>('/contacts/tags-some-stats', { type, ids }).then(
    (r) => (r ?? []).reduce((s, x) => s + num(x.count), 0),
  );

/**
 * 目录显示的数量 = 目录内标签之和。
 * 老项目先看统计结果里有没有目录自己的 id,没有就显示「未统计」——
 * 于是子标签明明都有数,目录却永远空着。
 */
export function countOf(row: TagItem, all: TagItem[], stats: Map<string, number>) {
  if (!row.folder) return stats.get(row.id);
  const kids = all.filter((t) => !t.folder && t.parent === row.id);
  if (kids.length === 0) return 0;
  if (!kids.some((k) => stats.has(k.id))) return undefined;
  return kids.reduce((s, k) => s + (stats.get(k.id) ?? 0), 0);
}

/* ---------- 调色板 ---------- */

/** 仅用于旧标签缺失颜色时的稳定派生，保留原来的顺序和长度。 */
const LEGACY_TAG_COLORS = [
  '#ff4d4f',
  '#ff7043',
  '#ffca28',
  '#ffa726',
  '#f2da04',
  '#26a69a',
  '#66bb6a',
  '#9ccc65',
  '#c4d330',
  '#5c6bc0',
  '#42a5f5',
  '#29b6f6',
  '#26c6d9',
  '#ab47bb',
  '#ec407a',
  '#ef5350',
  '#afaeb0',
  '#000000',
  '#ff00ff',
  '#000080',
] as const;

/** 标签预设，顺序与产品色板一致；名称用于选择器提示，保存时仍使用完整 hex。 */
export const TAG_COLOR_PRESETS = [
  { name: 'red-1', zhName: '红色-1', hex: '#ffccc7' },
  { name: 'red-3', zhName: '红色-3', hex: '#ff7875' },
  { name: 'red-5', zhName: '红色-5', hex: '#f5222d' },
  { name: 'red-6', zhName: '红色-6', hex: '#cf1322' },
  { name: 'volcano-1', zhName: '火山-1', hex: '#ffd8bf' },
  { name: 'volcano-3', zhName: '火山-3', hex: '#ff9c6e' },
  { name: 'volcano-5', zhName: '火山-5', hex: '#fa541c' },
  { name: 'volcano-6', zhName: '火山-6', hex: '#d4380d' },
  { name: 'magenta-1', zhName: '玫红-1', hex: '#ffd6e7' },
  { name: 'magenta-3', zhName: '玫红-3', hex: '#ff85c0' },
  { name: 'magenta-5', zhName: '玫红-5', hex: '#eb2f96' },
  { name: 'magenta-6', zhName: '玫红-6', hex: '#c41d7f' },
  { name: 'gold-1', zhName: '金色-1', hex: '#fff1b8' },
  { name: 'gold-3', zhName: '金色-3', hex: '#ffd666' },
  { name: 'gold-5', zhName: '金色-5', hex: '#faad14' },
  { name: 'gold-6', zhName: '金色-6', hex: '#d48806' },
  { name: 'yellow-1', zhName: '黄色-1', hex: '#ffffb8' },
  { name: 'yellow-3', zhName: '黄色-3', hex: '#fff566' },
  { name: 'yellow-5', zhName: '黄色-5', hex: '#fadb14' },
  { name: 'yellow-6', zhName: '黄色-6', hex: '#d4b106' },
  { name: 'purple-1', zhName: '紫色-1', hex: '#efdbff' },
  { name: 'purple-3', zhName: '紫色-3', hex: '#b37feb' },
  { name: 'purple-5', zhName: '紫色-5', hex: '#722ed1' },
  { name: 'purple-6', zhName: '紫色-6', hex: '#531dab' },
  { name: 'green-1', zhName: '绿色-1', hex: '#d9f7be' },
  { name: 'green-3', zhName: '绿色-3', hex: '#95de64' },
  { name: 'green-5', zhName: '绿色-5', hex: '#52c41a' },
  { name: 'green-6', zhName: '绿色-6', hex: '#389e0d' },
  { name: 'cyan-1', zhName: '青色-1', hex: '#b5f5ec' },
  { name: 'cyan-3', zhName: '青色-3', hex: '#5cdbd3' },
  { name: 'cyan-5', zhName: '青色-5', hex: '#13c2c2' },
  { name: 'cyan-6', zhName: '青色-6', hex: '#08979c' },
  { name: 'blue-1', zhName: '蓝色-1', hex: '#bae0ff' },
  { name: 'blue-3', zhName: '蓝色-3', hex: '#69b1ff' },
  { name: 'blue-5', zhName: '蓝色-5', hex: '#1677ff' },
  { name: 'blue-6', zhName: '蓝色-6', hex: '#0958d9' },
  { name: 'grey-4', zhName: '灰色-4', hex: '#d9d9d9' },
  { name: 'grey-6', zhName: '灰色-6', hex: '#8c8c8c' },
  { name: 'grey-7', zhName: '灰色-7', hex: '#595959' },
  { name: 'grey-9', zhName: '灰色-9', hex: '#262626' },
] as const;

export const TAG_COLORS = TAG_COLOR_PRESETS.map((color) => color.hex);

/** 没颜色时的兜底底色 */
export const TAG_FALLBACK_COLOR = '#94a3b8';

/**
 * 给定种子时结果稳定 —— 编辑同一个标签不会每次渲染换一种颜色。
 *
 * 新建标签从当前色板随机取色；旧标签的种子派生继续使用历史色板，避免换色。
 */
export function randomTagColor(seed?: string) {
  if (seed === undefined) return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return LEGACY_TAG_COLORS[h % LEGACY_TAG_COLORS.length];
}

/* ---------- 校验与筛选 ---------- */

export const TAG_NAME_MAX = 64;

export function validateTag(d: TagDraft) {
  const e: { name?: string; color?: string } = {};
  const name = d.name.trim();
  if (!name) e.name = 'tg.errNameEmpty';
  else if (name.length > TAG_NAME_MAX) e.name = 'tg.errNameLong';
  if (!d.color) e.color = 'tg.errColorEmpty';
  return e;
}

export function validateFolder(d: FolderDraft) {
  const e: { name?: string } = {};
  // 老项目这里没 trim,一个空格就能建出一个看不见名字的目录
  if (!d.name.trim()) e.name = 'tg.errFolderNameEmpty';
  return e;
}

/**
 * 列表筛选。关键词只在当前目录内匹配；parent 为 null 时显式查看全部目录。
 */
export function filterTags(all: TagItem[], parent: string | null, keyword: string) {
  const k = keyword.trim().toLowerCase();
  return all.filter((t) => {
    if (parent !== null && t.parent !== parent) return false;
    if (!k) return true;
    // 名字缺失判为不匹配。老项目 `undefined?.indexOf() !== -1` 会判成命中
    return t.name.toLowerCase().includes(k) || t.description.toLowerCase().includes(k);
  });
}

/** 目录排在标签前面,与老项目的拖拽判定假设一致 */
export const foldersFirst = (rows: TagItem[]) => [
  ...rows.filter((r) => r.folder),
  ...rows.filter((r) => !r.folder),
];
