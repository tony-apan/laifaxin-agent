import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@/api/schema';

interface AuthState {
  token: string | null;
  /** 组织 id:真实后端要求随请求回传(见 api/client.ts 的鉴权头) */
  orgId: string | null;
  user: AuthUser | null;
  login: (token: string, user: AuthUser, orgId?: string | null) => void;
  /**
   * 切换工作区。orgId 会随每个请求作为 `uid` 头发出去(见 api/client.ts),
   * 所以改了它之后**所有后续请求打的都是新工作区** —— 调用方必须紧接着
   * 把 query 缓存清掉,否则界面上还是上一个企业的数据。
   * 正确的调用方式见 features/enterprise/use-switch-workspace.ts,别直接用这个。
   */
  setOrgId: (orgId: string) => void;
  logout: () => void;
}

/** 会话(持久化)。路由守卫用 useAuthStore.getState() 同步读取 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      orgId: null,
      user: null,
      login: (token, user, orgId = null) => set({ token, user, orgId }),
      setOrgId: (orgId) => set({ orgId }),
      logout: () => set({ token: null, user: null, orgId: null }),
    }),
    { name: 'lfx.auth' },
  ),
);
