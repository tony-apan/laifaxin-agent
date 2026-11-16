import { type MyPermissions, normalizePermissions } from '@laifaxin/core/permissions';
import type { ApiClient } from './client';

export function createPermissionsApi(client: Pick<ApiClient, 'postEnvelope'>) {
  const { postEnvelope } = client;
  /**
   * 我在当前企业里的权限。
   *
   * ⚠️ **后端会返回空对象 `{}` 的三种情况,前端都会看成「什么都不能做」**:
   * 不是这个企业的成员、成员状态不是 `ok`(待审核/已停用/退出中)、
   * 或者角色被删了。所以看到全禁时别急着怀疑权限配错了,先看成员状态。
   */
  const getMyPermissions = async (): Promise<MyPermissions> =>
    normalizePermissions(await postEnvelope<unknown>('/account/permissions', {}));
  return { getMyPermissions };
}
