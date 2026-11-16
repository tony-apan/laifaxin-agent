import type { PageQuery, PageResult } from '@laifaxin/core/pagination';

export type { PageQuery, PageResult } from '@laifaxin/core/pagination';

import { type Envelope, postEnvelope } from '@/api/auth';

import { fetchJson } from '@/api/client';

import type { Coupon } from '@/api/topbar';

/* ---------- 账户额度:礼包码 ---------- */

export const redeemCode = (cdkey: string) =>
  postEnvelope<unknown>('/expenses/cdkey/redeem-code', { cdkey: cdkey.trim() });

/* ---------- 充值中心 ---------- */

export interface RechargeGood {
  goodsType?: string;
  goodsId: string;
  name?: string;
  subject?: string;
  desc?: string;
  price: number;
  /** 点数商品的到账数量,服务端未返回时由前端按商品文案展示 */
  count?: number;
  items?: { id: string; count: number }[];
  recommend?: boolean;
  disabled?: boolean;
}

export interface SellGoodsResult {
  countGoods?: RechargeGood[];
  /** 会员商品按 goodsType 分组,每组通常包含 month/year 两个 goods */
  vipGoods?: Record<string, { goods?: RechargeGood[] }>;
}

export interface RechargeOrderInfo {
  order_id: string;
  id?: string;
  total?: number;
  pay_amount?: number;
  url?: string;
  subject?: string;
  status?: 0 | 1 | 2 | number;
  goods_type?: string;
  goods_count?: number;
  commission?: number;
  minus_price?: number;
  create_time?: number;
  app?: 'wechat' | 'alipay' | string;
}

export const getSellGoods = () => postEnvelope<SellGoodsResult>('/expenses/sell-goods', {});

export const createRechargeOrder = (params: {
  goodsType: string;
  goodsId: string;
  goodsCount?: number;
  goodsPrice?: number;
  ticket_money?: number;
  ticket_id?: string;
  useCommission?: boolean;
  payCommission?: number;
}) =>
  postEnvelope<{ order_id?: string }>('/expenses/pay/order-create', {
    goodsCount: 1,
    ...params,
  });

export const getRechargeOrder = (id: string) =>
  postEnvelope<RechargeOrderInfo>('/expenses/pay/order-info', { id });

/** 未支付时可能返回 success:false 且没有 message,它是等待态。 */
export async function checkRechargeOrder(id: string) {
  const result = await fetchJson<Envelope<{ done?: boolean }>>('/payment/qr-order-check', {
    method: 'POST',
    body: JSON.stringify({ id, host: window.location.host }),
  });
  if (!result.success && result.message) throw new Error(result.message);
  return { done: result.success && result.data?.done === true };
}

export interface RechargeCoupon extends Coupon {
  validTypes?: string[];
  start_time?: number;
  isUsed?: boolean;
}

export const getRechargeCoupons = () =>
  postEnvelope<RechargeCoupon[]>('/ticket/unused-list', {}).then((data) => data ?? []);

/** commission 为分;order-create 的 payCommission 却是元。 */
export const getRechargeExtra = () =>
  postEnvelope<{ commission?: number }>('/expenses/user-extra', {});

/* ---------- 充值订单 ---------- */

/** 0=待付款 1=已支付 2=已取消。页签叫「待付款」,表格里旧版叫「未付款」,这里统一成前者 */
export type OrderStatus = 0 | 1 | 2;

export interface OrderRow {
  _id?: string;
  order_id?: string;
  status?: OrderStatus | number;
  /** 后端商品类型标识 */
  goods_type?: string;
  subject?: string;
  /** 订单金额,单位分 */
  total?: number;
  create_time?: number;
}

export const listOrders = (q: PageQuery) =>
  postEnvelope<PageResult<OrderRow>>('/expenses/orders/show', q);

export const countOrders = () =>
  postEnvelope<Record<string, number>>('/expenses/orders/show-count', {});

export const cancelOrder = (id: string) =>
  postEnvelope<unknown>('/expenses/pay/order-cancel', { id });

export const deleteOrder = (id: string) =>
  postEnvelope<unknown>('/expenses/pay/order-delete', { id });

/* ---------- 消费明细 ---------- */

/** 收入类:充值/兑换/赠送;消耗类:发送/获客/验证/AI */
export const BILLING_TYPES = [
  'total',
  'recharge',
  'exchange',
  'admin',
  'send',
  'search',
  'verify',
  'ai',
] as const;

export type BillingType = (typeof BILLING_TYPES)[number];

export interface BillingRow {
  _id?: string;
  userid?: string;
  /** 账单分类,值域即 BILLING_TYPES。**不是 type** —— type 在真实行里是另一个东西(点数桶) */
  source?: string;
  /** 真实行的点数桶:giveCount / creditCount / search / sendCount / ai。与 source 不同域 */
  type?: string;
  /** 说明文案,字段名是 message 不是 desc */
  message?: string;
  /** 点数变动,正数入账负数消耗。**不是钱**,不要除 100 */
  count?: number;
  /** 变动后的剩余点数 */
  total?: number;
  create_time?: number;
}

export const listBilling = (q: PageQuery) =>
  postEnvelope<PageResult<BillingRow>>('/expenses/billing/show', q);

/**
 * 明细数字的三态。旧实现写成 `(num>0&&'green')||(num<0&&'red')||value`,
 * num===0 时两个条件都假,会把字符串 "0" 当颜色传下去 —— 这里显式分三支。
 */
export const billingTone = (n: number | undefined): 'up' | 'down' | 'flat' => {
  if (typeof n !== 'number' || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
};
