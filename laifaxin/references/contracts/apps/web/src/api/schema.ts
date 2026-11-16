export type { AuthUser } from '@laifaxin/core/identity';

import { z } from 'zod';

export const staffIdSchema = z.enum(['wangjian', 'zhaoyiming', 'zhouyutong', 'wangzihao']);

export const avatarStyleSchema = z.enum(['me', 'a', 'b', 'c', 'warn']);

export type AvatarStyle = z.infer<typeof avatarStyleSchema>;

export const staffSchema = z.object({
  id: staffIdSchema,
  name: z.string(),
  email: z.string(),
  /** 演示用手机号:验证码登录 / 注册查重 / 密码重置都按它匹配 */
  phone: z.string(),
  /** 登录用户名:密码登录的第三种账号形态(邮箱 / 手机号 / 用户名) */
  username: z.string(),
  /** i18n key: common.roles.* */
  roleKey: z.string(),
});

export type Staff = z.infer<typeof staffSchema>;
