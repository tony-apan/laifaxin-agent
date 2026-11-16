import { z } from 'zod';
import type { AuthUser } from './identity';
/* ============================================================
   认证契约层
   路径与出入参对齐 laifaxin-web 现行实现(src/auth/view/*)。
   注意三处易错点:
   1. 注册的发码接口是唯一带 -send 后缀的,不要用模板拼接;
   2. 三条链路的提交接口后缀各不相同;
   3. 业务失败时 HTTP 仍是 200,必须看信封的 success,不能看状态码。
   ============================================================ */

export const AUTH_ENDPOINTS = {
  loginByPassword: '/user/login',
  loginPhoneCaptcha: '/user/login/phone-captcha',
  loginByPhone: '/user/login/by-phone',
  loginEmailCaptcha: '/user/login/email-captcha',
  loginByEmail: '/user/login/by-email',
  loginWechatQrcode: '/user/login/wechat-qrcode',
  loginWechatCheck: '/user/login/wechat-check',
  loginWeapp: '/user/login/weapp',
  bindWeapp: '/user/login/weapp-bind',
  weappPhoneCaptcha: '/user/login/weapp-phone-captcha',
  weappPhone: '/user/login/weapp-phone',
  weappWebQrcode: '/user/login/weapp-web/qrcode',
  weappWebCheck: '/user/login/weapp-web/check',
  weappWebCancel: '/user/login/weapp-web/cancel',
  weappWebInfo: '/user/login/weapp-web/info',
  weappWebDecision: '/user/login/weapp-web/decision',
  weappWebScanInfo: '/user/login/weapp-web/scan-info',
  weappWebScanDecision: '/user/login/weapp-web/scan-decision',
  weappWebScanPhoneCaptcha: '/user/login/weapp-web/scan-phone-captcha',
  weappWebScanPhone: '/user/login/weapp-web/scan-phone',
  loginCallCaptcha: '/user/login/call-captcha',
  registCallCaptcha: '/user/regist/call-captcha',
  resetCallCaptcha: '/user/reset/call-captcha',
  registWechatPhoneCaptcha: '/user/regist/wechat-phone-captcha',
  registWechatAndPhone: '/user/regist/wechat-and-phone',
  registPhoneCaptcha: '/user/regist/phone-captcha-send',
  registPhoneUser: '/user/regist/phone-user',
  resetPhoneCaptcha: '/user/reset/phone-captcha',
  resetPhonePassword: '/user/reset/phone-password',
  resetEmailCaptcha: '/user/reset/email-captcha',
  resetEmailPassword: '/user/reset/email-password',
} as const;

/** 登录成功后服务端下发的会话信息。user 为本项目 mock 附带,真实后端需另调用户接口补全。 */
export interface AuthSession {
  accesstoken: string;
  orgId?: string;
  uid?: string;
  user?: AuthUser;
  /** 未绑定手机号时仅展示建议，不阻止登录或使用。 */
  phoneBindingSuggested?: boolean;
}

/** UnionID 匹配老账号可直接登录；新身份或仅 OpenID 关联且无手机号时，先验证手机号。 */
export type WeappLoginResult =
  | { status: 'binding_required'; bindingTicket: string }
  | { status: 'ok'; session: AuthSession };

export interface WeappPhoneInput {
  bindingTicket: string;
  phone: string;
  phoneCode: string;
}

export type WeappPhoneProof =
  | (WeappPhoneInput & { captcha: string })
  | { bindingTicket: string; phoneGrantCode: string };

export interface WeappWebTicket {
  sceneId: string;
  /** Only the browser receives this secret. Never put it in the QR code or a URL. */
  pollToken: string;
}
export interface WeappWebQrcode extends WeappWebTicket {
  qrcode: string;
  expireSeconds: number;
}
export type WeappWebStatus = 'pending' | 'confirmed' | 'issuing' | 'ok' | 'cancelled' | 'expired';
export type WeappWebCheck =
  | { status: Exclude<WeappWebStatus, 'ok'>; scanned?: boolean }
  | { status: 'ok'; session: AuthSession };
export interface WeappWebInfo {
  status: WeappWebStatus;
  host?: string;
  expiresAt?: number;
}

/** 扫码端只持有确认信息或场景专用的手机号凭证，不接收 Web/小程序会话。 */
export type WeappWebScanDecision =
  | WeappWebInfo
  | {
      status: 'binding_required';
      bindingTicket: string;
      host?: string;
      expiresAt?: number;
    };

/* ---------- 共享字段规则(旧项目三条流程各有一套,此处统一为唯一版本) ---------- */

export const DEFAULT_PHONE_CODE = '86';

/**
 * 号段校验。旧项目用 npm 包 phone 做同样的事,这里按四个区号内联实现,
 * 避免为四条正则引入一个体积不小的依赖。
 */
const PHONE_PATTERNS: Record<string, RegExp> = {
  '86': /^1[3-9]\d{9}$/,
  '852': /^[456789]\d{7}$/,
  '853': /^6\d{7}$/,
  '886': /^9\d{8}$/,
};

export function isMobilePhoneNumber(phoneCode: string, phone: string): boolean {
  const pattern = PHONE_PATTERNS[phoneCode];
  if (!pattern) return false;
  return pattern.test(phone.trim());
}

/**
 * 邮箱校验。复刻旧项目 utils/mail.ts 的分段长度限制,但返回 boolean
 * (旧实现返回小写地址字符串,被当 boolean 用)。
 */
export function isValidEmail(input: string): boolean {
  const value = input.trim().toLowerCase();
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64) return false;
  if (!domain || domain.length > 128) return false;
  if (domain.split('.').some((seg) => seg.length > 63)) return false;
  return /^([a-z0-9]+(?:[._-][a-z0-9]+)*)@([a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,})$/i.test(value);
}

/* ---------- zod 字段(错误文案与旧项目逐字一致) ---------- */

/**
 * 校验文案走 i18n key(在 FieldError 处翻译),不写死中文——
 * 这些 schema 是模块级常量,拿不到 t();文案本身与旧项目逐字对应,见 i18n/auth.ts。
 */
export const VALIDATION = {
  phoneCodeRequired: 'validation.phoneCodeRequired',
  phoneRequired: 'validation.phoneRequired',
  phoneFormat: 'validation.phoneFormat',
  captchaRequired: 'validation.captchaRequired',
  captchaLength: 'validation.captchaLength',
  passwordRequired: 'validation.passwordRequired',
  passwordLength: 'validation.passwordLength',
  emailRequired: 'validation.emailRequired',
  emailFormat: 'validation.emailFormat',
  usernameRequired: 'validation.usernameRequired',
  usernameMin: 'validation.usernameMin',
  usernameMax: 'validation.usernameMax',
  networkError: 'validation.networkError',
  requestFailed: 'validation.requestFailed',
} as const;

export const phoneCodeSchema = z.string().min(1, VALIDATION.phoneCodeRequired);

// trim 与 isMobilePhoneNumber 内部保持一致,否则带空格的号码能过门控却在服务端匹配失败
export const phoneSchema = z
  .string()
  .trim()
  .min(1, VALIDATION.phoneRequired)
  .min(5, VALIDATION.phoneFormat)
  .max(12, VALIDATION.phoneFormat);

export const captchaSchema = z
  .string()
  .trim()
  .min(1, VALIDATION.captchaRequired)
  .min(6, VALIDATION.captchaLength);

export const passwordSchema = z
  .string()
  .min(1, VALIDATION.passwordRequired)
  .min(6, VALIDATION.passwordLength);

// toLowerCase 与 isValidEmail、服务端精确匹配对齐
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, VALIDATION.emailRequired)
  .refine(isValidEmail, VALIDATION.emailFormat);

export const usernameSchema = z
  .string()
  .trim()
  .min(1, VALIDATION.usernameRequired)
  .min(4, VALIDATION.usernameMin)
  .max(64, VALIDATION.usernameMax);

/* ---------- 表单 schema ---------- */

export const passwordLoginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;

export const phoneLoginSchema = z.object({
  phoneCode: phoneCodeSchema,
  phone: phoneSchema,
  captcha: captchaSchema,
});

export type PhoneLoginInput = z.infer<typeof phoneLoginSchema>;

export const emailLoginSchema = z.object({
  email: emailSchema,
  captcha: captchaSchema,
});

export type EmailLoginInput = z.infer<typeof emailLoginSchema>;

export const registerSchema = z.object({
  phoneCode: phoneCodeSchema,
  phone: phoneSchema,
  captcha: captchaSchema,
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const resetByPhoneSchema = z.object({
  phoneCode: phoneCodeSchema,
  phone: phoneSchema,
  captcha: captchaSchema,
  password: passwordSchema,
});

export type ResetByPhoneInput = z.infer<typeof resetByPhoneSchema>;

export const resetByEmailSchema = z.object({
  email: emailSchema,
  captcha: captchaSchema,
  password: passwordSchema,
});

export type ResetByEmailInput = z.infer<typeof resetByEmailSchema>;

/* ---------- 微信扫码 ---------- */

/** 二维码有效期兜底:后端给的 expire_seconds 非数字或 <=0 时用 600 秒 */
export const WECHAT_QR_FALLBACK_SECONDS = 600;

export interface WechatQrcode {
  /** 图片地址或 data URI,前端只负责显示 */
  qrcode: string;
  sceneId: string;
  expireSeconds: number;
  /** 取码时刻:有效期按它推算,组件重挂不会让过期的码「复活」 */
  issuedAt: number;
}

/** pending=还没扫 / new=新用户需绑手机号 / ok=可直接登录 */
export type WechatScanStatus = 'pending' | 'new' | 'ok';

export interface WechatCheck {
  status: WechatScanStatus;
  session?: AuthSession;
}

/** 真实后端是蛇形字段,在契约层转成驼峰,页面不感知 */
export interface WechatQrcodeWire {
  /** 真实后端字段名是 qrcodeUrl(已对 c.laifaxin.com 实测确认),不是 qrcode */
  qrcodeUrl: string;
  /** 真实后端回的是数字,路由 search 需要字符串 */
  scene_id: string | number;
  expire_seconds?: number;
}

export interface WechatCheckWire {
  status: WechatScanStatus;
  accesstoken?: string;
  orgId?: string;
  uid?: string;
  user?: AuthUser;
  phoneBindingSuggested?: boolean;
}

/** 微信绑定手机号:只要手机号 + 验证码,微信身份本身就是凭据,不设密码 */
export const wechatBindSchema = z.object({
  phoneCode: phoneCodeSchema,
  phone: phoneSchema,
  captcha: captchaSchema,
});

export type WechatBindInput = z.infer<typeof wechatBindSchema>;

/* ---------- 请求 ---------- */

/** wechat = 微信绑定手机号,发码端点与注册不同,且没有语音验证码 */
export type CaptchaScene = 'login' | 'regist' | 'reset' | 'wechat';

/** code=1101 的业务含义旧项目无注释,仅知它与成功同样使语音按钮消失 */
export const VOICE_CAPTCHA_CODE_1101 = 1101;
