/**
 * 后端的哨兵值。放在 `data` 层是因为 `lib` 和 `api` 都要用它,
 * 而 `lib` 是叶子层不能反向依赖 `api` —— 之前两边各写了一份
 * `const UNKNOWN = 'unkown'`,改一处漏一处的隐患。
 */

/**
 * 「未知」。**拼写就是 `unkown`,少一个 n** —— 前端、后端、数据库三方一致地这么拼,
 * 不是笔误,顺手改成 `unknown` 会让所有判等静默失效。
 *
 * 用到它的字段:`company_code`(未知国家)、`company_size`(未知规模)、
 * `verify_status` / `contactVerifyStatus`(未验证邮箱)。
 */
export const UNKNOWN = 'unkown';

/** 空值或 `unkown` 都算「未知」。后端两种都会回 */
export const isUnknown = (v: string | undefined | null): boolean => !v || v === UNKNOWN;
