import { z } from 'zod';
import { postEnvelope } from '@/api/auth';

const taskStatus = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const inviteStatusSchema = z.object({
  uid: z.string().min(1),
  pid: z
    .string()
    .nullish()
    .transform((value) => value ?? ''),
  inviteBindCount: z.number().nonnegative(),
  // 0 = 未满足条件，1 = 可领取，2 = 已领取。缺失状态不能当作已完成。
  inviteFriendsStatus: taskStatus,
  inviteWroteStatus: taskStatus,
});

export type InviteStatus = z.infer<typeof inviteStatusSchema>;
export type GrowthTaskType = 'inviteFriends' | 'inviteWrote';

export const getInviteStatus = async () =>
  inviteStatusSchema.parse(await postEnvelope<unknown>('/partner/invite-status', {}));

export const claimInviteReward = (type: GrowthTaskType) =>
  postEnvelope<void>('/partner/invite-reward', { type });

export const bindInviteCode = (inviteCode: string) =>
  postEnvelope<{ pid: string }>('/partner/invite-bind', { inviteCode: inviteCode.trim() });
