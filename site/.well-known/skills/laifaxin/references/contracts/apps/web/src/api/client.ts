import { type ApiMessageKey, type ApiRequestOptions, createApiClient } from '@laifaxin/api-client';
import i18n from 'i18next';
import { useAuthStore } from '@/stores/auth';

export { ApiError, PermissionDeniedError, SessionExpiredError } from '@laifaxin/api-client';

function message(key: ApiMessageKey): string {
  if (key === 'permissionDenied')
    return i18n.t('accessDenied.description', {
      ns: 'common',
      defaultValue: '当前账号暂无此功能的使用权限，请联系企业管理员开通。',
    });
  if (key === 'sessionExpired')
    return i18n.t('sessionExpired', {
      ns: 'auth',
      defaultValue: '登录已失效，请重新登录',
    });
  const text = i18n.isInitialized ? i18n.t(key, { ns: 'auth', defaultValue: '' }) : '';
  return text || key;
}
type WebRequestOptions = Omit<RequestInit, 'headers' | 'body'> & ApiRequestOptions;
/** Web owns environment, network, persistence and translations. */
export const apiClient = createApiClient<WebRequestOptions>({
  baseUrl: import.meta.env.VITE_API_BASE ?? '/api',
  transport: (url, options) => fetch(url, options),
  getSession: () => useAuthStore.getState(),
  onSessionExpired: () => useAuthStore.getState().logout(),
  getHost: () => (typeof window === 'undefined' ? '' : window.location.host),
  message,
});
/** Preserve native Web Headers/tuple input and cancellation options. */
export function fetchJson<T>(
  path: string,
  init?: Omit<WebRequestOptions, 'headers'> & { headers?: HeadersInit },
) {
  return apiClient.fetchJson<T>(path, {
    ...init,
    headers: init?.headers ? Object.fromEntries(new Headers(init.headers)) : undefined,
  });
}
