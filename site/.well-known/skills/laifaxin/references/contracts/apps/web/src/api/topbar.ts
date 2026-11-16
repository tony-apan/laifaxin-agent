import { createWorkspaceApi } from '@laifaxin/api-client/workspace';
import type { QueryClient } from '@tanstack/react-query';
import { postEnvelope } from '@/api/auth';
import { PermissionDeniedError, SessionExpiredError } from '@/api/client';

/**
 * 顶栏六个入口的接口契约。路径与字段照搬 laifaxin-web 现行实现,
 * 命名上的坑原样保留并加注,免得日后「顺手改对」反而对不上后端:
 * - /enterprise/my-organies 少一个 z,后端就是这么拼的
 * - ticket 在这里是「优惠券」不是工单(老项目目录名 header-tickets 有误导性)
 * - 券的金额字段是分,展示要除以 100
 */

/* ---------- 工作区切换 ---------- */

/**
 * 把当前工作区固化到服务端;本地 orgId 也要同步,鉴权头靠它。
 *
 * 这条留在 topbar 是因为它打的是 `/account/save-config`(账号配置),
 * 不是企业接口。企业本身的类型与读写在 `api/enterprise.ts`。
 */
export const { saveCurrentOrg } = createWorkspaceApi({ postEnvelope });

/** 会员等级名。企业与个人两套口径,照抄旧项目 utils/user.ts 的 getVipLevelName */
export function vipLevelKey(isOrg: boolean | undefined, vip: number | undefined): string {
  if (isOrg) {
    if (vip === 1) return 'orgStandard';
    if (vip === 2) return 'orgPro';
    if (vip === 3) return 'orgFlagship';
    return 'free';
  }
  if (vip === 1) return 'vip';
  if (vip === 2) return 'svip';
  // 旧项目 vip=3 且非企业时没有映射,会把数字 3 直接渲染出来。这里补一个名字
  if (vip === 3) return 'svipPlus';
  return 'free';
}

/* ---------- 优惠券 ---------- */

/** 服务端按当前工作区发券，只返回本次新发放的券。 */
export interface GrantedCoupon
  extends Pick<Coupon, 'name' | 'desc' | 'type' | 'validTypes' | 'minus_price' | 'minimum'> {
  ticketId: string;
  startTime?: number;
  endTime?: number;
}

export const claimNewCoupons = () => postEnvelope<GrantedCoupon[]>('/ticket/new-list', {});

export interface Coupon {
  _id?: string;
  ticketId?: string;
  name: string;
  desc?: string;
  /** coupon=优惠券 mapVip=地图VIP,其余原样显示 */
  type?: string;
  /** 可抵扣的商品类型 */
  validTypes?: string[];
  /** 面额,单位分 */
  minus_price?: number;
  /** 使用门槛,单位分;为空表示无门槛 */
  minimum?: number;
  /** 0=未使用 1=已使用 */
  status?: number;
  /** 到期时间戳(ms) */
  end_time?: number;
  /** 剩余毫秒,后端下发 */
  remain?: number;
}

/**
 * 真实 /ticket/all-list 要分页体、回的是 {list} 而不是数组
 * (旧项目 ticket-list-drawer.tsx:101 传 {sort:{},pageSize:100,current:1,filter:{type:'coupon'}},
 * onSuccess 里 `const { list } = data ?? { list: [] }`)。
 * 当成数组会在 .filter 上直接抛 TypeError,整个抽屉崩掉。
 */
export const listCoupons = async (): Promise<Coupon[]> => {
  const data = await postEnvelope<{ list?: Coupon[] } | undefined>('/ticket/all-list', {
    sort: {},
    pageSize: 100,
    current: 1,
    filter: { type: 'coupon' },
  });
  return data?.list ?? [];
};

/** 券分三档:未使用 / 已使用 / 已过期。过期判定用 end_time,不信任后端分类 */
export type CouponBucket = 'valid' | 'used' | 'expired';

export function couponBucket(c: Coupon, now: number): CouponBucket {
  if (c.status === 1) return 'used';
  if (c.end_time && c.end_time <= now) return 'expired';
  return 'valid';
}

/* ---------- 权益(每月赠送额度) ---------- */

export interface GiveStatus {
  /** null/undefined = 本期尚未领取;0 = 已领取但用完 */
  creditCount?: number | null;
  creditQuota?: number;
  creditExpireTime?: number;
  verifyCount?: number | null;
  verifyQuota?: number;
  verifyExpireTime?: number;
}

export type GiveType = 'creditCount' | 'verifyCount';

export const getGiveStatus = () => postEnvelope<GiveStatus>('/expenses/give-status', {});
export const claimGive = (type: GiveType) => postEnvelope<unknown>('/expenses/give-get', { type });

/** 待领项数:count 为 null/undefined 即本期未领 */
export const pendingGiveCount = (g: GiveStatus | undefined): number =>
  g ? [g.creditCount, g.verifyCount].filter((v) => v === null || v === undefined).length : 0;

/* ---------- 后台任务 ---------- */

/** cluesSearch=拓客 cluesSave=客户保存 aiRating=AI 评分 */
export type TaskType = 'cluesSearch' | 'cluesSave' | 'aiRating';
export type TaskStatus =
  | 'waiting'
  | 'running'
  | 'finished'
  | 'paused'
  | 'aborted'
  /** 点数不足导致的暂停,与 paused 文案不同 */
  | 'poor';

export interface BackendTask {
  id: string;
  type: TaskType | string;
  status?: TaskStatus | string;
  /** 0-100 */
  progress?: number;
  /** 已处理条数 */
  finished?: number;
  contactSaveCount?: number;
  companySaveCount?: number;
}

/** 工作区初始化和打开「我的任务」时读取名单，进度轮询复用缓存。 */
const backendTaskList = {
  queryKey: ['backend-task-list'] as const,
  queryFn: () => postEnvelope<BackendTask[]>('/operation/backend-task-list', {}),
  staleTime: Infinity,
  gcTime: Infinity,
};

export async function refreshBackendTaskList(client: QueryClient) {
  await client.fetchQuery({ ...backendTaskList, staleTime: 0, retry: false });
  await client.invalidateQueries({ queryKey: ['backend-tasks'] });
}

export async function listTasks(client: QueryClient, signal: AbortSignal): Promise<BackendTask[]> {
  signal.throwIfAborted();
  const running = await client.ensureQueryData(backendTaskList);
  signal.throwIfAborted();
  // 列表只返回运行中的任务；保留本地推送及已结束任务，再补上服务端的新任务。
  const known = client.getQueryData<BackendTask[]>(['backend-tasks']) ?? [];
  const tasks = new Map(known.map((task) => [`${task.type}:${task.id}`, task]));
  for (const task of running) {
    const key = `${task.type}:${task.id}`;
    if (!tasks.has(key)) tasks.set(key, task);
  }
  const refs = [...tasks.values()];
  const result: BackendTask[] = [];
  // 限制并发；保留本会话收到的任务，完成/暂停后不被运行中列表抹掉。
  for (let offset = 0; offset < refs.length; offset += 4) {
    signal.throwIfAborted();
    const batch = await Promise.all(
      refs.slice(offset, offset + 4).map(async (task) => {
        if (task.status === 'finished' || task.status === 'aborted') return task;
        try {
          return {
            ...task,
            ...(await postEnvelope<BackendTask>('/operation/backend-task-status', {
              type: task.type,
              id: task.id,
            })),
          };
        } catch (error) {
          if (error instanceof SessionExpiredError || error instanceof PermissionDeniedError)
            throw error;
          // 一个任务状态查询失败不影响其余任务；保留已有信息供下一轮重试。
          return task;
        }
      }),
    );
    signal.throwIfAborted();
    result.push(...batch);
  }
  return result;
}

type TaskRef = { type: string; id: string };

export function removeCachedTask(client: QueryClient, { type, id }: TaskRef) {
  const withoutDeleted = (tasks: BackendTask[] | undefined) =>
    tasks?.filter((item) => item.type !== type || item.id !== id);
  // 忽略删除前已发出的名单请求，避免迟到的响应重新插入任务。
  void client.cancelQueries({ queryKey: backendTaskList.queryKey });
  client.setQueryData(backendTaskList.queryKey, withoutDeleted);
  client.setQueryData(['backend-tasks'], withoutDeleted);
}

export const startTask = (ref: TaskRef) =>
  postEnvelope<unknown>('/operation/backend-task-start', ref);
export const stopTask = (ref: TaskRef) =>
  postEnvelope<unknown>('/operation/backend-task-stop', ref);
export const abortTask = (ref: TaskRef) =>
  postEnvelope<unknown>('/operation/backend-task-abort', ref);
export const deleteTask = (ref: TaskRef) =>
  postEnvelope<unknown>('/operation/backend-task-delete', ref);

/** 仍在推进中的任务:决定顶栏按钮是否显示进度 */
export const isTaskLive = (s: string | undefined) => s === 'running' || s === 'waiting';

/* ---------- 通知 ---------- */

export interface MessageCount {
  total?: number;
  service?: number;
  activity?: number;
  payment?: number;
  task?: number;
  partner?: number;
  security?: number;
}

export const getMessageCount = () =>
  postEnvelope<MessageCount>('/notifications/messages-count', {});
