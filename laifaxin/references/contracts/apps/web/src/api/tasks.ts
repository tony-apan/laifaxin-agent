import { createTasksApi } from '@laifaxin/api-client/tasks';
import { postEnvelope } from './auth';

export {
  draftFromTask,
  emptyTaskDraft,
  fromPriority,
  isFinished,
  TASK_PRIORITIES,
  TASK_TYPES,
  type Task,
  type TaskDraft,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
  taskBody,
  toPriority,
  toTask,
  validateTask,
} from '@laifaxin/core/tasks';

import i18n from 'i18next';

export { listSubordinateUsers, type SubordinateUser, subordinateLabel } from './crm-export';
export const TASK_QUERY_KEYS = ['crm-tasks', 'calendar-tasks', 'crm-task'];
export const {
  listCrmTasks,
  listCrmCalendarTasks,
  getNextFollowTask,
  deleteCrmTasks,
  getTask,
  addTask,
  saveTask,
  deleteTask,
  setTaskStatus,
} = createTasksApi({ postEnvelope }, () => i18n.t('tk.notFound', { ns: 'tasks' }));
