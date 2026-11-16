/* ============================================================
   领域模型与 API 契约(zod 为唯一事实来源,类型全部推导)
   ============================================================ */

/* ---------- 认证 ---------- */
export interface AuthUser {
  staffId: string;
  name: string;
  email: string;
  /** i18n key: roles.* */
  roleKey: string;
}
