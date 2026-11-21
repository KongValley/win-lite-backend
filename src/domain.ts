export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatusFilter = 'all' | 'open' | 'completed';
export type TaskPriorityFilter = 'all' | TaskPriority;

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly completed: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTaskInput {
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly completed: boolean;
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string;
  readonly priority?: TaskPriority;
  readonly completed?: boolean;
}

export interface TaskListQuery {
  readonly status: TaskStatusFilter;
  readonly priority: TaskPriorityFilter;
  readonly q: string;
  readonly limit: number;
  readonly offset: number;
}

export type TaskListOptions = Partial<TaskListQuery>;

export interface TaskListResult {
  readonly items: Task[];
  readonly total: number;
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return (
    typeof value === 'string' &&
    (TASK_PRIORITIES as readonly string[]).includes(value)
  );
}
