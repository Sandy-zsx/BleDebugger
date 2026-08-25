import { useRef, useCallback, useEffect } from "react";
import RNBluetoothClassic, { type StandardOptions } from "react-native-bluetooth-classic";

const RECONNECT_OPTIONS: StandardOptions = {
  delimiter: "\n",
  secureSocket: false,
  charset: "ascii",
};

interface UseReconnectOptions {
  /** 设备地址 */
  address: string;
  /** 是否启用自动重连 */
  enabled: boolean;
  /** 最大重连次数，默认 5 */
  maxAttempts?: number;
  /** 重连间隔基数（毫秒），默认 1000。实际间隔 = baseDelay * attempt */
  baseDelayMs?: number;
  /** 连接成功回调 */
  onReconnected?: (address: string) => void;
  /** 所有重连尝试均失败时回调 */
  onReconnectFailed?: (address: string) => void;
  /** 重连状态变化回调 */
  onStatusChange?: (status: ReconnectStatus) => void;
}

export interface ReconnectStatus {
  /** 是否正在重连 */
  isReconnecting: boolean;
  /** 当前第几次尝试 */
  attempt: number;
  /** 最大尝试次数 */
  maxAttempts: number;
  /** 下次重连间隔 (ms) */
  nextDelayMs: number;
}

/**
 * 蓝牙断线自动重连 Hook。
 *
 * 当检测到设备意外断开时，按递增间隔自动尝试重连：
 *   第 1 次：~1 秒后
 *   第 2 次：~2 秒后
 *   第 3 次：~4 秒后（指数退避）
 *   ...
 *   最多 maxAttempts 次，全部失败后触发 onReconnectFailed。
 */
export function useReconnect({
  address,
  enabled,
  maxAttempts = 5,
  baseDelayMs = 1000,
  onReconnected,
  onReconnectFailed,
  onStatusChange,
}: UseReconnectOptions) {
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const emitStatus = useCallback(
    (isReconnecting: boolean) => {
      onStatusChange?.({
        isReconnecting,
        attempt: attemptRef.current,
        maxAttempts,
        nextDelayMs: baseDelayMs * Math.pow(2, attemptRef.current),
      });
    },
    [maxAttempts, baseDelayMs, onStatusChange]
  );

  /** 开始自动重连流程 */
  const startReconnect = useCallback(() => {
    if (!enabled) return;
    abortRef.current = false;
    attemptRef.current = 0;
    attemptReconnect();
  }, [enabled]);

  const attemptReconnect = useCallback(async () => {
    if (abortRef.current) return;

    attemptRef.current += 1;

    if (attemptRef.current > maxAttempts) {
      emitStatus(false);
      onReconnectFailed?.(address);
      return;
    }

    emitStatus(true);

    try {
      await RNBluetoothClassic.connectToDevice(address, RECONNECT_OPTIONS);
      // 连接成功
      attemptRef.current = 0;
      emitStatus(false);
      onReconnected?.(address);
    } catch {
      // 重连失败，等待后重试
      const delay = baseDelayMs * Math.pow(2, attemptRef.current - 1);
      timerRef.current = setTimeout(() => {
        attemptReconnect();
      }, delay);
    }
  }, [address, baseDelayMs, maxAttempts, enabled, emitStatus, onReconnected, onReconnectFailed]);

  /** 取消重连 */
  const cancelReconnect = useCallback(() => {
    abortRef.current = true;
    clearTimer();
    attemptRef.current = 0;
    emitStatus(false);
  }, [emitStatus]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      abortRef.current = true;
      clearTimer();
    };
  }, []);

  return {
    startReconnect,
    cancelReconnect,
  };
}
