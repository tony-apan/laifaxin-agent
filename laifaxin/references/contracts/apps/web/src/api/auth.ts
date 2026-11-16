import { createAuthApi } from '@laifaxin/api-client/auth';
import { apiClient } from './client';

export { AuthError } from '@laifaxin/api-client';
export * from '@laifaxin/core/auth';
export type { Envelope } from '@laifaxin/core/common';
export const { postEnvelope, postEnvelopeFull } = apiClient;
export const {
  getWeappWebQrcode,
  checkWeappWebLogin,
  cancelWeappWebLogin,
  getWechatQrcode,
  bindWechatPhone,
  checkWechatScan,
  sendPhoneCaptcha,
  sendVoiceCaptcha,
  sendEmailCaptcha,
  loginByPassword,
  loginByPhone,
  loginByEmail,
  registerPhoneUser,
  resetPasswordByPhone,
  resetPasswordByEmail,
} = createAuthApi(apiClient);

// 区号显示文案属于 Web；公共包只保留校验规则。
export const PHONE_CODES = [
  { value: '86', label: '中国大陆(+86)' },
  { value: '852', label: '中国香港(+852)' },
  { value: '853', label: '中国澳门(+853)' },
  { value: '886', label: '中国台湾(+886)' },
] as const;
