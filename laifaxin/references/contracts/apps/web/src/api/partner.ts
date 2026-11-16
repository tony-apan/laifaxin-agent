import { z } from 'zod';
import { postEnvelope } from '@/api/auth';
import type { PageQuery, PageResult } from '@/api/expenses';
import { codeSchema } from '@/api/personal';

export interface InviteInfo {
  inviteCode: string;
  inviteCount: number;
  /** 佣金及消费汇总的单位是厘（1 元 = 1000 厘），不是订单接口的分。 */
  inviteCost: number;
  commAmount: number;
  commission: number;
  monthCashed: boolean;
}
export interface InviteRecord {
  _id: string;
  uid: string;
  nickname?: string;
  hasWechat?: boolean;
  hasPhone?: boolean;
  costAmount?: number;
  commAmount?: number;
  create_time?: number;
}
export interface CommissionRecord {
  _id: string;
  uid: string;
  total_fee?: number;
  commission?: number;
  create_time?: number;
}
export interface CashRecord {
  _id: string;
  type?: string;
  bankName?: string;
  cardId?: string;
  /** 提现明细金额已经是元，不再除以 1000。 */
  money?: number;
  tax?: number;
  real?: number;
  status?: string;
  create_time?: number;
}
export interface BankInfo {
  name?: string;
  phone?: string;
  commission: number;
  cashCards?: { name?: string; bankName: string; cardId: string }[];
}
export const partnerSearchSchema = z.object({
  tab: z.enum(['record', 'commission', 'cash']).catch('record'),
  page: z.coerce.number().int().positive().catch(1),
  order: z.enum(['asc', 'desc']).catch('desc'),
});
export type PartnerTab = z.infer<typeof partnerSearchSchema>['tab'];
export const getInviteInfo = () => postEnvelope<InviteInfo>('/partner/invite-info', {});
export const listInviteRecords = (q: PageQuery) =>
  postEnvelope<PageResult<InviteRecord>>('/partner/invite-record', q);
export const listCommissionRecords = (q: PageQuery) =>
  postEnvelope<PageResult<CommissionRecord>>('/partner/invite-commission', q);
export const listCashRecords = (q: PageQuery) =>
  postEnvelope<PageResult<CashRecord>>('/partner/cash-out', q);
export const getBankInfo = () => postEnvelope<BankInfo>('/account/bank-info', {});

export const BANKS = [
  '中国银行',
  '中国工商银行',
  '中国建设银行',
  '中国农业银行',
  '中国邮政储蓄银行',
  '中国光大银行',
  '中国民生银行',
  '中信银行',
  '交通银行',
  '华夏银行',
  '招商银行',
  '兴业银行',
  '平安银行',
] as const;
export const cashSchema = z.object({
  realName: z.string().min(1, 'errors.realName'),
  bankName: z.string().min(1, 'errors.bank'),
  cardId: z
    .string()
    .trim()
    .regex(/^[1-9](?:\d{14}|\d{15}|\d{18})$/, 'errors.card'),
  money: z
    .number()
    .min(100, 'errors.money')
    .max(10000, 'errors.money')
    .refine((v) => v % 100 === 0, 'errors.money'),
  captcha: codeSchema,
});
export type CashInput = z.infer<typeof cashSchema>;
export const requestCash = (value: CashInput) =>
  postEnvelope<void>('/payment/cash-out', cashSchema.parse(value));
export const maximumCash = (commission: number) =>
  Math.max(0, Math.min(10000, Math.floor(commission / 100000) * 100));
export const cashUnavailable = (info: InviteInfo) =>
  info.monthCashed ? 'partner.monthCashed' : info.commission < 100000 ? 'partner.belowMinimum' : '';
export function cashBreakdown(money: number) {
  const amount = Number.isFinite(money) && money > 0 ? money : 0;
  const tax =
    Math.round((amount <= 800 ? 0 : amount <= 4000 ? (amount - 800) * 0.2 : amount * 0.16) * 100) /
    100;
  return { tax, real: Math.round((amount - tax) * 100) / 100 };
}
export const inviteLink = (origin: string, code: string) => {
  const url = new URL(`/regist/${encodeURIComponent(code)}`, origin);
  return url.toString();
};
export const partnerMoney = (
  value: number | undefined,
  unit: 'li' | 'yuan' = 'li',
  locale = 'zh-CN',
) =>
  value === undefined
    ? '—'
    : new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'CNY',
        minimumFractionDigits: 2,
      }).format(value / (unit === 'li' ? 1000 : 1));
export const maskedCard = (card?: string) => (card ? `•••• ${card.slice(-4)}` : '—');
