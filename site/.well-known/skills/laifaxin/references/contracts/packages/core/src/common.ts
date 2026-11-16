/** 服务端统一响应信封 */
export interface Envelope<T = unknown> {
  success: boolean;
  message?: string;
  code?: number | string;
  data?: T;
}

/** Platform-neutral cancellation check used between paginated requests. */
export interface CancellationCheck {
  throwIfAborted(): void;
}
