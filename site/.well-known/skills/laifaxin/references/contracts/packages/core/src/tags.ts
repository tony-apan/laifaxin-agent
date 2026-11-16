/**
 * 设置 · 标签管理。
 *
 * 目录与标签**在同一个扁平数组里**,靠 `folder` 布尔区分,靠 `parent` 串成两层树,
 * 根是字符串 `'0'`。目录不能嵌套 —— 建目录的接口根本没有 parent 参数。
 *
 * 老项目这块的口径最乱,下面几条是这里刻意收敛掉的:
 * - **排序只发同一层的 id**。老项目拖拽时把「当前过滤视图的全部行 id」(目录和标签
 *   混在一起)整包发出去,搜索或翻页时还会拿一个残缺子集覆盖整份顺序。
 * - **换目录与排序拆成两个函数**,虽然后端是同一个接口。换目录时目标目录的
 *   现有成员由 {@link tagsAfterMove} 算,只取标签、排除目录 —— 老项目在
 *   `dirId='0'` 时会把所有顶级目录的 id 一起塞进去。
 * - **删除带上 type**。老项目单删/批删都不传 type,而切 Tab 又不清空选中项,
 *   于是能拿上一个 Tab 的 id 去删这个 Tab。
 * - **搜索尊重当前目录**,且名字缺失的行判定为不匹配(老项目 `undefined !== -1`
 *   会把它当成命中)。
 */

/** 后端认的全集(`api/contacts.ts` 那份 7 值)。`mail` 由邮件分类维护,不在设置页 */
export const TAG_TYPES = [
  'contacts',
  'company',
  'phone',
  'extMap',
  'clues',
  'mail',
  'extGoogleSearch',
] as const;

export type TagType = (typeof TAG_TYPES)[number];

export interface TagItem {
  id: string;
  name: string;
  /** true = 目录。后端给 undefined 时归一成 false */
  folder: boolean;
  /** 父目录 id;顶级(含目录自身)是 ROOT_DIR */
  parent: string;
  /** 完整 hex,含 `#`。目录不存颜色 */
  color: string;
  description: string;
  /** 创建者 userid */
  userid: string;
  create_time: number;
  /** 标签下的对象数,来自独立的统计接口,不在列表里 */
  count?: number;
}

/** Shared wire normalization keeps Web and mobile names, folders and colors consistent. */
export function normalizeTag(r: Record<string, unknown>): TagItem {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const time = typeof r.create_time === 'string' ? Number(r.create_time) : r.create_time;
  return {
    id: str(r.id),
    name: str(r.name),
    folder: r.folder === true,
    parent: str(r.parent) || '0',
    color: str(r.color),
    description: str(r.description),
    userid: str(r.userid),
    create_time: typeof time === 'number' && Number.isFinite(time) ? time : 0,
  };
}

/** Undefined means malformed data: do not silently replace it with an empty selection. */
export function customerTagIds(value: unknown): string[] | undefined {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim()))
    return undefined;
  return [...new Set(value)];
}
export function sameTagIds(a: string[], b: string[]) {
  const left = new Set(a),
    right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}
export function customerTagsPatch(
  original: unknown,
  selected: string[],
  latest: unknown,
  editable: boolean,
  catalog: TagItem[],
): { tags?: string[] } {
  const before = customerTagIds(original),
    current = customerTagIds(latest);
  if (!before || !current) throw new Error('customers.tagsInvalid');
  if (sameTagIds(before, selected)) return {};
  if (!editable) throw new Error('customers.fieldsChanged');
  if (!sameTagIds(current, before) && !sameTagIds(current, selected))
    throw new Error('customers.editConflict');
  const allowed = new Set(catalog.filter((tag) => !tag.folder).map((tag) => tag.id));
  if (selected.some((id) => !before.includes(id) && !allowed.has(id)))
    throw new Error('customers.tagsChanged');
  return { tags: [...new Set(selected)] };
}
