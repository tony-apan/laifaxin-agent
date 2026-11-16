/** 登录人资料使用 /account/info；/account/current 是当前工作区，不能互相替代。 */
export interface PersonalInfo {
  uid: string;
  name?: string;
  nickname?: string;
  avatar?: string;
  email?: string;
  phone?: string | number;
  /** 兼容旧服务端：账号原有的微信收件标识。 */
  wechat?: boolean;
  /** 任一微信登录身份已关联，包括小程序。 */
  wechatBound?: boolean;
  wechatName?: string;
  create_time?: number;
  login_time?: number;
}
