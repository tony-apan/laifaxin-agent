import { createPersonalApi } from '@laifaxin/api-client/personal';
import { z } from 'zod';
import { isMobilePhoneNumber, isValidEmail, postEnvelope } from '@/api/auth';

export type { PersonalInfo } from '@laifaxin/core/personal';

export const personalSearchSchema = z.object({
  type: z.enum(['general', 'notifications', 'security']).catch('general'),
});
export type PersonalTab = z.infer<typeof personalSearchSchema>['type'];
export type VerifyChannel = 'phone' | 'email';
export type SecurityAction = VerifyChannel | 'password';

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(4, 'errors.username')
    .max(64, 'errors.username')
    .regex(/[a-zA-Z]/, 'errors.username'),
  nickname: z.string().trim().min(1, 'errors.nickname').max(64, 'errors.nickname'),
});
export const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'errors.code');
export const passwordChangeSchema = z
  .object({
    password: z.string().min(6, 'errors.password'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'errors.confirm', path: ['confirm'] });
export const emailRenewSchema = z.object({
  email: z.string().trim().toLowerCase().refine(isValidEmail, 'errors.email'),
  captcha: codeSchema,
});
export const phoneRenewSchema = z
  .object({
    phone: z.string().trim(),
    phoneCode: z.string(),
    captcha: codeSchema,
  })
  .refine((v) => isMobilePhoneNumber(v.phoneCode, v.phone), {
    message: 'errors.phone',
    path: ['phone'],
  });

export const { getPersonalInfo } = createPersonalApi({ postEnvelope });
export const savePersonalInfo = (value: { name?: string; nickname?: string; avatarUrl?: string }) =>
  postEnvelope<void>('/account/info-save', value);
export const sendVerification = (type: VerifyChannel, action: 'verify' | 'cash' = 'verify') =>
  postEnvelope<void>('/account/verify-captcha', { type, action });
export const verifyIdentity = (type: VerifyChannel, captcha: string) =>
  postEnvelope<void>('/account/verify-code', { type, captcha: codeSchema.parse(captcha) });
export const sendRenewCode = (value: { email: string } | { phone: string; phoneCode: string }) =>
  postEnvelope<void>('/account/renew-captcha', value);
export const renewEmail = (value: z.infer<typeof emailRenewSchema>) =>
  postEnvelope<void>('/account/renew-email', emailRenewSchema.parse(value));
export const renewPhone = (value: z.infer<typeof phoneRenewSchema>) =>
  postEnvelope<void>('/account/renew-phone', phoneRenewSchema.parse(value));
export const changePassword = (value: z.infer<typeof passwordChangeSchema>) =>
  postEnvelope<void>('/account/password-change', passwordChangeSchema.parse(value));
export const unbindWechat = () => postEnvelope<void>('/account/wechat-unbind', {});

export interface BindingQr {
  scene_id: number;
  qrcodeUrl: string;
  expire_seconds: number;
  issuedAt: number;
}
export async function getBindingQr(): Promise<BindingQr> {
  const data = await postEnvelope<Omit<BindingQr, 'issuedAt'>>('/account/wechat-official-qrcode', {
    type: 'binding',
  });
  return { ...data, issuedAt: Date.now() };
}
export const checkBindingQr = async (scene_id: number) =>
  (await postEnvelope<{ status?: string; success?: boolean } | undefined>(
    '/account/wechat-official-check',
    { scene_id },
  )) ?? null;
export const getWechatSync = (url: string) =>
  postEnvelope<{ appid: string; state: string; redirectUrl: string }>('/account/wechat-web-state', {
    type: 'sync',
    url,
  });
export const completeWechatSync = (code: string, state: string) =>
  postEnvelope<{ uid?: string; url?: string }>('/user/wechat-web-callback', { code, state });

export function wechatReturnPath(value: string | undefined, origin: string) {
  const fallback = '/account/setting?type=general';
  if (!value) return fallback;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && url.pathname === '/account/setting'
      ? `${url.pathname}${url.search}`
      : fallback;
  } catch {
    return fallback;
  }
}

export type NotificationId = 'login' | 'mailNew';
export type NotificationChannel = 'site' | 'mail' | 'wechat';
export type NotificationConfig = Partial<
  Record<NotificationId, Partial<Record<NotificationChannel, { on?: boolean; disabled?: boolean }>>>
>;
export const getNotificationConfig = () =>
  postEnvelope<{ noticeConfig?: NotificationConfig; wechatOfficialSubscribed?: boolean | null }>(
    '/notifications/message-config',
    {},
  );
export const saveNotificationConfig = (
  id: NotificationId,
  type: NotificationChannel,
  on: boolean,
) => postEnvelope<void>('/notifications/message-config-save', { id, type, on });

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export function validateAvatar(file: Pick<File, 'size' | 'type'>) {
  if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.type)) return 'errors.imageType';
  if (file.size >= AVATAR_MAX_BYTES) return 'errors.avatarSize';
  return '';
}

export interface IdentityInfo {
  type?: string;
  realName?: string;
  idNum?: string;
  status?: number;
  authTime?: string;
}
export const identitySchema = z.object({
  realName: z.string().trim().min(1, 'errors.realName').max(8, 'errors.realName'),
  idNum: z
    .string()
    .trim()
    .regex(
      /^[1-9]\d{5}(18|19|[23]\d)\d{2}(0[1-9]|1[012])(0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]$/,
      'errors.idNum',
    ),
  imageUrl: z.string().min(1, 'errors.idImage'),
  agree: z.boolean().refine(Boolean, 'errors.agree'),
});
export const getIdentityInfo = () => postEnvelope<IdentityInfo>('/account/id-info', {});
export const saveIdentityInfo = (value: z.infer<typeof identitySchema>) =>
  postEnvelope<void>('/account/id-save', { ...identitySchema.parse(value), type: 'user' });
