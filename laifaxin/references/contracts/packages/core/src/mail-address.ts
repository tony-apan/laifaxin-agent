import { splitTopLevel } from './mail';

/**
 * 收件人格式是**硬约束**:后端 `mailToTester` 的三个正则分支全都要求尖括号 ——
 * `"名字" <a@b.com>` / `<a@b.com>` / `名字 <a@b.com>`。**裸 `a@b.com` 直接被拒**。
 * 所有手输路径都要过这个函数,不能改成存裸地址。
 */
export function wrapAddress(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  // 已经是带尖括号的完整形式就别再包一层
  if (/<[^>]+>\s*$/.test(v)) return v;
  return `<${v}>`;
}

/**
 * 粘贴一串地址时的切分。
 *
 * 两道:先按 `, ; 换行` 切,再对**不含尖括号的片段**按空白二次切。
 * 只切一道不行 —— 只按逗号切,`a@b.com b@c.com` 这种空格分隔的粘贴会变成一条;
 * 一上来就按空白切,`"Keller, Anna" <a@x.com>` 的显示名会被拆散。
 */
export function splitAddresses(raw: string): string[] {
  return splitTopLevel(raw, /[,;\n]/)
    .flatMap((part) =>
      // 带尖括号的是「显示名 + 地址」,里面的空格是名字的一部分,不能再切
      part.includes('<') ? [part] : part.split(/\s+/).filter(Boolean),
    )
    .map(wrapAddress)
    .filter(Boolean);
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** 地址里那个邮箱本体合不合法。`"名字" <a@b.com>` 取尖括号里的部分 */
export function isValidAddress(v: string): boolean {
  const m = v.match(/<([^>]+)>/);
  return EMAIL_RE.test((m ? m[1] : v).trim());
}

/** 取地址里的邮箱本体,用来去重与「回复全部时去掉自己」 */
export const addressEmail = (v: string) => {
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim().toLowerCase();
};

export const dedupeAddresses = (list: string[]) => {
  const seen = new Set<string>();
  return list.filter((a) => {
    const k = addressEmail(a);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
