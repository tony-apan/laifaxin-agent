import {
  AUTH_ENDPOINTS,
  type AuthSession,
  type CaptchaScene,
  type EmailLoginInput,
  type PasswordLoginInput,
  type PhoneLoginInput,
  type RegisterInput,
  type ResetByEmailInput,
  type ResetByPhoneInput,
  WECHAT_QR_FALLBACK_SECONDS,
  type WeappLoginResult,
  type WeappPhoneInput,
  type WeappPhoneProof,
  type WeappWebCheck,
  type WeappWebInfo,
  type WeappWebQrcode,
  type WeappWebScanDecision,
  type WeappWebTicket,
  type WechatBindInput,
  type WechatCheck,
  type WechatCheckWire,
  type WechatQrcode,
  type WechatQrcodeWire,
} from '@laifaxin/core/auth';
import type { Envelope } from '@laifaxin/core/common';
import { type ApiClient, AuthError } from './client';

export function createAuthApi(client: Pick<ApiClient, 'postEnvelope' | 'fetchJson' | 'getHost'>) {
  const { postEnvelope, fetchJson, getHost: host } = client;
  const loginByWeapp = (code: string, inviteCode?: string) =>
    postEnvelope<WeappLoginResult>(AUTH_ENDPOINTS.loginWeapp, { code, inviteCode });

  // 兼容已关联账号；首次关联必须使用 bindWeappPhone 验证手机号。
  const bindWeapp = async (code: string, session: AuthSession): Promise<void> => {
    const res = await fetchJson<Envelope<{ bound: boolean }>>(AUTH_ENDPOINTS.bindWeapp, {
      method: 'POST',
      headers: { accesstoken: session.accesstoken, uid: session.uid ?? '' },
      body: JSON.stringify({ code, host: host() }),
    });
    if (!res.success || res.data?.bound !== true)
      throw new AuthError(res.message || 'account.wechatBindFailed');
  };
  const getWechatQrcode = async (inviteCode?: string): Promise<WechatQrcode> => {
    const data = await postEnvelope<WechatQrcodeWire>(AUTH_ENDPOINTS.loginWechatQrcode, {
      inviteCode,
    });
    const expire = Number(data.expire_seconds);
    return {
      qrcode: data.qrcodeUrl,
      sceneId: String(data.scene_id),
      expireSeconds: Number.isFinite(expire) && expire > 0 ? expire : WECHAT_QR_FALLBACK_SECONDS,
      issuedAt: Date.now(),
    };
  };

  const bindWechatPhone = (body: WechatBindInput & { sceneId: string }) =>
    postEnvelope<AuthSession>(AUTH_ENDPOINTS.registWechatAndPhone, {
      phone: body.phone,
      phoneCode: body.phoneCode,
      captcha: body.captcha,
      // 真实后端字段名是 scene_id
      scene_id: body.sceneId,
    });

  const checkWechatScan = async (sceneId: string): Promise<WechatCheck> => {
    // 这个端点**不能**走 postEnvelope 的失败语义:真实后端在「还没扫码」时回的就是
    // {success:false} 且不带 message(已对 c.laifaxin.com 实测),旧项目 sign-in-wechat.tsx
    // 也是拿不到 status 就静默忽略、继续轮询。当成错误的话,微信登录一挂上就报错、永远登不上。
    let res: Envelope<WechatCheckWire>;
    try {
      res = await fetchJson<Envelope<WechatCheckWire>>(AUTH_ENDPOINTS.loginWechatCheck, {
        method: 'POST',
        body: JSON.stringify({ scene_id: sceneId, host: host() }),
      });
    } catch {
      // 单次网络抖动不该打断轮询,交给下一拍;二维码失效由客户端倒计时收口
      return { status: 'pending' };
    }
    const data = res.success ? res.data : undefined;
    if (data?.status === 'new') return { status: 'new' };
    if (data?.status !== 'ok') return { status: 'pending' };
    return {
      status: 'ok',
      session: {
        accesstoken: data.accesstoken ?? '',
        orgId: data.orgId,
        uid: data.uid,
        user: data.user,
        ...(data.phoneBindingSuggested ? { phoneBindingSuggested: true } : {}),
      },
    };
  };

  const sendPhoneCaptcha = (
    scene: CaptchaScene,
    body: { phone: string; phoneCode: string; verifyParam?: string },
  ) => {
    const path =
      scene === 'login'
        ? AUTH_ENDPOINTS.loginPhoneCaptcha
        : scene === 'regist'
          ? AUTH_ENDPOINTS.registPhoneCaptcha
          : scene === 'wechat'
            ? AUTH_ENDPOINTS.registWechatPhoneCaptcha
            : AUTH_ENDPOINTS.resetPhoneCaptcha;
    return postEnvelope<unknown>(path, body);
  };

  /**
   * 语音验证码:三条链路路径同名同参,是唯一可以安全共用一个函数的验证码接口。
   * verifyParam 复用上一次滑块验证的结果,不重新弹滑块(与旧实现一致)。
   */
  const sendVoiceCaptcha = (
    scene: Exclude<CaptchaScene, 'wechat'>,
    body: { phone: string; phoneCode: string; verifyParam?: string },
  ) => {
    const path =
      scene === 'login'
        ? AUTH_ENDPOINTS.loginCallCaptcha
        : scene === 'regist'
          ? AUTH_ENDPOINTS.registCallCaptcha
          : AUTH_ENDPOINTS.resetCallCaptcha;
    return postEnvelope<unknown>(path, body);
  };

  const sendEmailCaptcha = (scene: 'login' | 'reset', body: { email: string }) =>
    postEnvelope<unknown>(
      scene === 'login' ? AUTH_ENDPOINTS.loginEmailCaptcha : AUTH_ENDPOINTS.resetEmailCaptcha,
      body,
    );

  const loginByPassword = (body: PasswordLoginInput) =>
    postEnvelope<AuthSession>(AUTH_ENDPOINTS.loginByPassword, body);

  const loginByPhone = (body: PhoneLoginInput) =>
    postEnvelope<AuthSession>(AUTH_ENDPOINTS.loginByPhone, body);

  const loginByEmail = (body: EmailLoginInput) =>
    postEnvelope<AuthSession>(AUTH_ENDPOINTS.loginByEmail, body);

  const registerPhoneUser = (body: RegisterInput & { inviteCode?: string }) =>
    postEnvelope<AuthSession>(AUTH_ENDPOINTS.registPhoneUser, body);

  const resetPasswordByPhone = (body: ResetByPhoneInput) =>
    postEnvelope<unknown>(AUTH_ENDPOINTS.resetPhonePassword, body);

  const resetPasswordByEmail = (body: ResetByEmailInput) =>
    postEnvelope<unknown>(AUTH_ENDPOINTS.resetEmailPassword, body);
  return {
    getWeappWebScanInfo: (sceneId: string) =>
      postEnvelope<WeappWebInfo>(AUTH_ENDPOINTS.weappWebScanInfo, { sceneId }),
    decideWeappWebScan: (sceneId: string, confirm: boolean, code: string, inviteCode?: string) =>
      postEnvelope<WeappWebScanDecision>(AUTH_ENDPOINTS.weappWebScanDecision, {
        sceneId,
        confirm,
        code,
        inviteCode,
      }),
    sendWeappWebPhoneCaptcha: (body: WeappPhoneInput & { sceneId: string }) =>
      postEnvelope<{ sent: boolean }>(AUTH_ENDPOINTS.weappWebScanPhoneCaptcha, { ...body }),
    confirmWeappWebPhone: (body: WeappPhoneProof & { sceneId: string }) =>
      postEnvelope<WeappWebInfo>(AUTH_ENDPOINTS.weappWebScanPhone, { ...body }),
    getWeappWebQrcode: () => postEnvelope<WeappWebQrcode>(AUTH_ENDPOINTS.weappWebQrcode, {}),
    checkWeappWebLogin: (ticket: WeappWebTicket) =>
      postEnvelope<WeappWebCheck>(AUTH_ENDPOINTS.weappWebCheck, { ...ticket }),
    cancelWeappWebLogin: (ticket: WeappWebTicket) =>
      postEnvelope<WeappWebInfo>(AUTH_ENDPOINTS.weappWebCancel, { ...ticket }),
    getWeappWebInfo: (sceneId: string) =>
      postEnvelope<WeappWebInfo>(AUTH_ENDPOINTS.weappWebInfo, { sceneId }),
    decideWeappWebLogin: (sceneId: string, confirm: boolean, code?: string) =>
      postEnvelope<WeappWebInfo>(AUTH_ENDPOINTS.weappWebDecision, { sceneId, confirm, code }),
    sendWeappPhoneCaptcha: (body: WeappPhoneInput) =>
      postEnvelope<{ sent: boolean }>(AUTH_ENDPOINTS.weappPhoneCaptcha, { ...body }),
    bindWeappPhone: (body: WeappPhoneProof) =>
      postEnvelope<AuthSession>(AUTH_ENDPOINTS.weappPhone, { ...body }),
    loginByWeapp,
    bindWeapp,
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
  };
}
