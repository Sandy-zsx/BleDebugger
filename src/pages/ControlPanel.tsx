import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import RNBluetoothClassic, {
  type BluetoothNativeDevice,
  type BluetoothDeviceReadEvent,
  type BluetoothEventSubscription,
} from "react-native-bluetooth-classic";
import CircularProgress from "../components/CircularProgress";
import Toast, { type ToastMessage } from "../components/Toast";
import { useReconnect, type ReconnectStatus } from "../hooks/useReconnect";
import {
  parseResponse,
  parsePumpResponse,
  buildCommand,
  COMMANDS,
  type DeviceState,
  type LogEntry,
} from "../utils/parser";
import { Colors, TypeScale, Spacing, Radius } from "../theme";

/** 指令超时时间（毫秒） */
const COMMAND_TIMEOUT_MS = 5000;
/** 心跳间隔（毫秒）—— 定期通信防止 HC-05 空闲断开 */
const HEARTBEAT_INTERVAL_MS = 10000;

interface ControlPanelProps {
  device: BluetoothNativeDevice;
  onDisconnect: () => void;
  onBack: () => void;
}

/** 发送指令并记录日志（不阻塞） */
async function writeToDevice(
  address: string,
  cmd: string,
  addLog: (entry: Omit<LogEntry, "id">) => void
): Promise<void> {
  const message = buildCommand(cmd);
  addLog({
    timestamp: new Date(),
    direction: "send",
    raw: cmd,
  });
  await RNBluetoothClassic.writeToDevice(address, message);
}

export default function ControlPanel({
  device,
  onDisconnect,
  onBack,
}: ControlPanelProps) {
  const [state, setState] = useState<DeviceState>({
    humidity: null,
    mode: null,
    pump: null,
    adc: null,
    raw: "",
  });
  const [reportActive, setReportActive] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [reconnectStatus, setReconnectStatus] = useState<ReconnectStatus | null>(null);
  const [disconnected, setDisconnected] = useState(false);

  const logIdRef = useRef(0);
  const readSubRef = useRef<BluetoothEventSubscription | null>(null);
  const disconSubRef = useRef<BluetoothEventSubscription | null>(null);
  const errorSubRef = useRef<BluetoothEventSubscription | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const manualDisconnectRef = useRef(false);
  const toastIdRef = useRef(0);

  // ---- Toast 辅助 ----
  const showToast = useCallback(
    (text: string, type: ToastMessage["type"] = "info") => {
      toastIdRef.current += 1;
      setToast({ id: toastIdRef.current, text, type });
    },
    []
  );

  // ---- 日志辅助 ----
  const addLog = useCallback((entry: Omit<LogEntry, "id">) => {
    logIdRef.current += 1;
    const withId = { ...entry, id: logIdRef.current };
    setLogs((prev) => {
      const next = [...prev, withId];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  // ---- 指令超时处理 ----
  const clearCommandTimeout = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startCommandTimeout = useCallback(
    (label: string) => {
      clearCommandTimeout();
      timeoutRef.current = setTimeout(() => {
        setSending(null);
        showToast(`指令 ${label} 超时，未收到响应`, "warning");
      }, COMMAND_TIMEOUT_MS);
    },
    [clearCommandTimeout, showToast]
  );

  // 组件卸载清理
  useEffect(() => {
    return () => {
      clearCommandTimeout();
    };
  }, [clearCommandTimeout]);

  // ---- 订阅设备数据 ----
  useEffect(() => {
    readSubRef.current = RNBluetoothClassic.onDeviceRead(
      device.address,
      (event: BluetoothDeviceReadEvent) => {
        // delimiter="\n" 已将 \n 作为分隔符消费，event.data 末尾只残留 \r
        const raw = event.data.replace(/\r$/, "").trim();
        if (!raw) return;

        // 任何接收到的数据都清除超时
        clearCommandTimeout();
        setSending(null);

        // 解析
        const parsed = parseResponse(raw);
        const pumpResult = parsePumpResponse(raw);

        addLog({
          timestamp: new Date(),
          direction: "receive",
          raw,
          parsed,
        });

        // 更新状态（保留已有值作为 fallback）
        setState((prev) => ({
          humidity: parsed.humidity ?? prev.humidity,
          mode: parsed.mode ?? prev.mode,
          pump: parsed.pump ?? prev.pump,
          adc: parsed.adc ?? prev.adc,
          raw,
        }));

        // 泵操作反馈
        if (pumpResult.command) {
          if (pumpResult.success) {
            const newPumpState = pumpResult.command === "PUMP_ON" ? "ON" : "OFF";
            setState((prev) => ({ ...prev, pump: newPumpState }));
            showToast(
              pumpResult.command === "PUMP_ON" ? "水泵已开启" : "水泵已关闭",
              "success"
            );
          } else if (pumpResult.reason) {
            showToast(`操作被拒绝：${pumpResult.reason}`, "warning");
          }
        }

        // 自动上报状态
        if (
          raw.includes("Auto report STARTED") ||
          raw.includes("Report started")
        ) {
          setReportActive(true);
          showToast("自动上报已开启（每 2 秒）", "info");
        } else if (
          raw.includes("Auto report STOPPED") ||
          raw.includes("Report stopped")
        ) {
          setReportActive(false);
          showToast("自动上报已停止", "info");
        }
      }
    );

    return () => {
      readSubRef.current?.remove();
    };
  }, [device.address, addLog, clearCommandTimeout, showToast]);

  // ---- 断线检测 ----
  useEffect(() => {
    disconSubRef.current = RNBluetoothClassic.onDeviceDisconnected((event) => {
      // 只关心当前设备的断线
      if (event.device.address !== device.address) return;

      addLog({
        timestamp: new Date(),
        direction: "receive",
        raw: "⚠ 设备已断开连接",
      });

      if (manualDisconnectRef.current) {
        // 用户主动断开 → 返回扫描页
        manualDisconnectRef.current = false;
        onDisconnect();
      } else {
        // 意外断线 → 触发自动重连
        setDisconnected(true);
        showToast("设备连接已断开，正在尝试重连...", "warning");
      }
    });

    return () => {
      disconSubRef.current?.remove();
    };
  }, [device.address, addLog, showToast, onDisconnect]);

  // ---- 错误监听 ----
  useEffect(() => {
    errorSubRef.current = RNBluetoothClassic.onError((event) => {
      console.warn("蓝牙错误:", event);
      addLog({
        timestamp: new Date(),
        direction: "receive",
        raw: `⚠ 错误: ${JSON.stringify(event)}`,
      });
    });

    return () => {
      errorSubRef.current?.remove();
    };
  }, [addLog]);

  // ---- 自动重连 ----
  const {
    startReconnect,
    cancelReconnect,
  } = useReconnect({
    address: device.address,
    enabled: disconnected,
    maxAttempts: 5,
    baseDelayMs: 1000,
    onReconnected: (addr) => {
      setDisconnected(false);
      setReconnectStatus(null);
      showToast("已重新连接", "success");
      addLog({
        timestamp: new Date(),
        direction: "receive",
        raw: "✅ 自动重连成功",
      });
    },
    onReconnectFailed: (addr) => {
      setReconnectStatus(null);
      showToast("自动重连失败，请手动重试", "error");
      addLog({
        timestamp: new Date(),
        direction: "receive",
        raw: "❌ 自动重连失败，已达最大尝试次数",
      });
    },
    onStatusChange: (status) => {
      setReconnectStatus(status);
    },
  });

  // 断线后自动触发重连
  useEffect(() => {
    if (disconnected) {
      startReconnect();
    }
  }, [disconnected, startReconnect]);

  // ---- 心跳保活 ----
  useEffect(() => {
    if (disconnected) return;

    const sendHeartbeat = async () => {
      try {
        const message = buildCommand(COMMANDS.ADC);
        await RNBluetoothClassic.writeToDevice(device.address, message);
      } catch {
        // 心跳失败静默处理
      }
    };

    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current != null) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [device.address, disconnected]);

  // ---- 发送指令 ----
  const send = useCallback(
    async (cmd: string, label: string) => {
      if (disconnected) {
        showToast("设备未连接，无法发送指令", "warning");
        return;
      }

      setSending(label);
      startCommandTimeout(label);
      try {
        await writeToDevice(device.address, cmd, addLog);
      } catch (error) {
        clearCommandTimeout();
        setSending(null);
        console.error(`发送 ${cmd} 失败:`, error);
        showToast(`发送 ${label} 失败`, "error");
      }
    },
    [device.address, addLog, disconnected, showToast, clearCommandTimeout, startCommandTimeout]
  );

  // ---- 手动断开 ----
  const handleDisconnect = useCallback(async () => {
    manualDisconnectRef.current = true;
    cancelReconnect();
    try {
      await RNBluetoothClassic.disconnectFromDevice(device.address);
    } catch {
      // 忽略
    }
    onDisconnect();
  }, [device.address, cancelReconnect, onDisconnect]);

  // ---- 手动浇水 ----
  const handleWateringToggle = useCallback(() => {
    if (state.pump === "ON") {
      send(COMMANDS.PUMP_OFF, "PUMP_OFF");
    } else {
      send(COMMANDS.PUMP_ON, "PUMP_ON");
    }
  }, [state.pump, send]);

  // ---- 上报切换 ----
  const handleReportToggle = useCallback(() => {
    if (reportActive) {
      send(COMMANDS.REPORT_STOP, "REPORT_STOP");
    } else {
      send(COMMANDS.REPORT_START, "REPORT_START");
    }
  }, [reportActive, send]);

  // ---- 断开后重连中界面 ----
  if (disconnected) {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleDisconnect} style={styles.topBarBtn}>
            <Text style={styles.topBarBtnText}>← 返回</Text>
          </TouchableOpacity>
          <View style={styles.topBarCenter}>
            <Text style={styles.deviceName}>连接已断开</Text>
          </View>
          <View style={styles.topBarSpacer} />
        </View>

        <View style={styles.reconnectContainer}>
          <ActivityIndicator color={Colors.electric} size="large" />
          <Text style={styles.reconnectTitle}>正在重新连接...</Text>
          {reconnectStatus && (
            <Text style={styles.reconnectDetail}>
              第 {reconnectStatus.attempt}/{reconnectStatus.maxAttempts} 次尝试
            </Text>
          )}
          <Text style={styles.reconnectDevice}>
            {device.name || device.address}
          </Text>

          <TouchableOpacity
            style={styles.reconnectCancelBtn}
            onPress={handleDisconnect}
          >
            <Text style={styles.reconnectCancelText}>取消并返回</Text>
          </TouchableOpacity>
        </View>

        <Toast message={toast} onDismiss={() => setToast(null)} />
      </View>
    );
  }

  // ---- 正常控制界面 ----
  return (
    <View style={styles.container}>
      {/* Toast */}
      <Toast message={toast} onDismiss={() => setToast(null)} />

      {/* 顶部栏 */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.topBarBtn}>
          <Text style={styles.topBarBtnText}>← 返回</Text>
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.deviceName} numberOfLines={1}>
            {device.name || "未知设备"}
          </Text>
          <Text style={styles.deviceAddr}>{device.address}</Text>
        </View>
        <TouchableOpacity onPress={handleDisconnect} style={styles.disconnectBtn}>
          <Text style={styles.disconnectBtnText}>断开</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 湿度圆形指示器 — Hero */}
        <View style={styles.humiditySection}>
          <CircularProgress value={state.humidity} size={200} strokeWidth={14} />
        </View>

        {/* 模式 + 水泵状态卡片 */}
        <View style={styles.statusRow}>
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>MODE</Text>
            <Text
              style={[
                styles.statusValue,
                {
                  color:
                    state.mode === "Auto"
                      ? Colors.electric
                      : state.mode === "Manual"
                        ? Colors.amber
                        : Colors.slate,
                },
              ]}
            >
              {state.mode === "Auto" ? "自动" : state.mode === "Manual" ? "手动" : "--"}
            </Text>
          </View>

          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>PUMP</Text>
            <View style={styles.statusValueRow}>
              <View
                style={[
                  styles.pumpDot,
                  {
                    backgroundColor: state.pump === "ON" ? Colors.emerald : Colors.lightStone,
                  },
                ]}
              />
              <Text
                style={[
                  styles.statusValue,
                  { color: state.pump === "ON" ? Colors.emerald : Colors.slate },
                ]}
              >
                {state.pump === "ON" ? "运行" : "关闭"}
              </Text>
            </View>
          </View>
        </View>

        {/* ADC 值 */}
        {state.adc != null && (
          <Text style={styles.adcText}>ADC 原始值：{state.adc}</Text>
        )}

        {/* 水泵控制按钮 — Primary Action */}
        <TouchableOpacity
          style={[
            styles.pumpBtn,
            state.pump === "ON" && styles.pumpBtnActive,
            sending != null && styles.btnDisabled,
          ]}
          onPress={handleWateringToggle}
          activeOpacity={0.7}
          disabled={sending != null}
        >
          {sending === "PUMP_ON" || sending === "PUMP_OFF" ? (
            <ActivityIndicator color={Colors.white} size="large" />
          ) : (
            <Text style={styles.pumpBtnIcon}>💧</Text>
          )}
          <Text style={styles.pumpBtnText}>
            {state.pump === "ON" ? "关闭水泵" : "手动浇水"}
          </Text>
          <Text style={styles.pumpBtnHint}>
            {sending === "PUMP_ON" || sending === "PUMP_OFF"
              ? "发送中..."
              : state.pump === "ON"
                ? "发送 PUMP_OFF"
                : "发送 PUMP_ON"}
          </Text>
        </TouchableOpacity>

        {/* 模式切换 */}
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={[styles.actionRow, sending != null && styles.btnDisabled]}
            onPress={() => send(COMMANDS.AUTO, "AUTO")}
            activeOpacity={0.6}
            disabled={sending != null}
          >
            <View style={styles.actionRowLeft}>
              <View style={[styles.actionDot, { backgroundColor: Colors.electric }]} />
              <View>
                <Text style={styles.actionLabel}>切换到自动模式</Text>
                <Text style={styles.actionHint}>
                  {state.mode === "Auto" ? "当前已是自动模式" : "发送 AUTO 指令"}
                </Text>
              </View>
            </View>
            {sending === "AUTO" ? (
              <ActivityIndicator color={Colors.electric} size="small" />
            ) : (
              <Text style={styles.actionArrow}>→</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, sending != null && styles.btnDisabled]}
            onPress={() => send(COMMANDS.ADC, "ADC")}
            activeOpacity={0.6}
            disabled={sending != null}
          >
            <View style={styles.actionRowLeft}>
              <View style={[styles.actionDot, { backgroundColor: Colors.slate }]} />
              <View>
                <Text style={styles.actionLabel}>查询状态</Text>
                <Text style={styles.actionHint}>发送 ADC? 获取实时读数</Text>
              </View>
            </View>
            {sending === "ADC" ? (
              <ActivityIndicator color={Colors.electric} size="small" />
            ) : (
              <Text style={styles.actionArrow}>→</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionRow,
              reportActive && styles.actionRowActive,
              sending != null && styles.btnDisabled,
            ]}
            onPress={handleReportToggle}
            activeOpacity={0.6}
            disabled={sending != null}
          >
            <View style={styles.actionRowLeft}>
              <View
                style={[
                  styles.actionDot,
                  { backgroundColor: reportActive ? Colors.emerald : Colors.slate },
                ]}
              />
              <View>
                <Text style={styles.actionLabel}>
                  自动上报
                  {reportActive && (
                    <Text style={styles.reportBadge}> ● 运行中</Text>
                  )}
                </Text>
                <Text style={styles.actionHint}>每 2 秒自动获取最新状态</Text>
              </View>
            </View>
            {sending === "REPORT_START" || sending === "REPORT_STOP" ? (
              <ActivityIndicator color={Colors.electric} size="small" />
            ) : (
              <Text style={styles.actionArrow}>
                {reportActive ? "■" : "→"}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 数据日志 — 终端风格 */}
        <View style={styles.logSection}>
          <View style={styles.logHeader}>
            <Text style={styles.logTitle}>数据日志</Text>
            <View style={styles.logHeaderRight}>
              <Text style={styles.logCount}>{logs.length}</Text>
              <TouchableOpacity onPress={() => setLogs([])}>
                <Text style={styles.clearLogText}>清空</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            style={styles.logContainer}
            nestedScrollEnabled
            ref={(ref) => {
              if (ref && logs.length > 0) {
                setTimeout(() => ref.scrollToEnd({ animated: false }), 50);
              }
            }}
          >
            {logs.length === 0 ? (
              <Text style={styles.logEmpty}>
                暂无数据 — 发送指令后，收发记录将显示在此处
              </Text>
            ) : (
              logs.map((entry) => (
                <View key={entry.id} style={styles.logEntry}>
                  <View style={styles.logMeta}>
                    <Text
                      style={[
                        styles.logDirection,
                        {
                          color:
                            entry.direction === "send"
                              ? Colors.electric
                              : Colors.emerald,
                        },
                      ]}
                    >
                      {entry.direction === "send" ? "SEND" : "RECV"}
                    </Text>
                    <Text style={styles.logTime}>
                      {entry.timestamp.toLocaleTimeString()}
                    </Text>
                  </View>
                  <Text style={styles.logRaw} selectable>
                    {entry.raw}
                  </Text>
                  {entry.parsed && (
                    <View style={styles.logParsed}>
                      {entry.parsed.humidity != null && (
                        <Text style={styles.logParsedItem}>
                          HUM {entry.parsed.humidity}%
                        </Text>
                      )}
                      {entry.parsed.mode && (
                        <Text style={styles.logParsedItem}>
                          {entry.parsed.mode}
                        </Text>
                      )}
                      {entry.parsed.pump && (
                        <Text style={styles.logParsedItem}>
                          PUMP:{entry.parsed.pump}
                        </Text>
                      )}
                      {entry.parsed.adc != null && (
                        <Text style={styles.logParsedItem}>
                          ADC:{entry.parsed.adc}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

// ---- 样式 ----
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },

  // ========== 顶部栏 ==========
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.text,
  },
  topBarBtn: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  topBarBtnText: {
    color: Colors.white,
    fontSize: 15,
  },
  topBarCenter: {
    flex: 1,
    alignItems: "center",
  },
  topBarSpacer: {
    width: 56,
  },
  deviceName: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "600",
    maxWidth: 200,
  },
  deviceAddr: {
    color: Colors.lightStone,
    fontSize: 11,
    marginTop: 3,
    fontFamily: "monospace",
  },
  disconnectBtn: {
    backgroundColor: Colors.whiteOverlay,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },
  disconnectBtnText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "600",
  },

  // ========== 滚动区域 ==========
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 48,
  },

  // ========== 湿度 Hero ==========
  humiditySection: {
    alignItems: "center",
    paddingTop: 32,
    paddingBottom: 24,
  },

  // ========== 状态卡片 ==========
  statusRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 12,
  },
  statusCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 18,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: Colors.slate,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  statusValue: {
    fontSize: 22,
    fontWeight: "700",
  },
  statusValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pumpDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  // ========== ADC 文本 ==========
  adcText: {
    textAlign: "center",
    fontSize: 12,
    color: Colors.slate,
    marginTop: 16,
    fontFamily: "monospace",
  },

  // ========== 水泵按钮（Primary Action） ==========
  pumpBtn: {
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 40,
    marginTop: 20,
    paddingVertical: 32,
    backgroundColor: Colors.brand,
    borderRadius: 100,
    shadowColor: Colors.brand,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  pumpBtnActive: {
    backgroundColor: Colors.red,
    shadowColor: Colors.red,
  },
  pumpBtnIcon: {
    fontSize: 36,
  },
  pumpBtnText: {
    color: Colors.white,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 8,
  },
  pumpBtnHint: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    marginTop: 4,
    fontFamily: "monospace",
  },

  // ========== 按钮禁用 ==========
  btnDisabled: {
    opacity: 0.45,
  },

  // ========== 操作行（Secondary Actions） ==========
  actionSection: {
    marginTop: 20,
    paddingHorizontal: 20,
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 16,
    borderLeftWidth: 3,
    borderLeftColor: Colors.electric,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  actionRowActive: {
    borderLeftColor: Colors.emerald,
    backgroundColor: "#F0FDF4",
  },
  actionRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  actionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
  },
  actionHint: {
    fontSize: 11,
    color: Colors.slate,
    marginTop: 2,
  },
  actionArrow: {
    fontSize: 16,
    color: Colors.lightStone,
    fontWeight: "600",
  },
  reportBadge: {
    fontSize: 11,
    color: Colors.emerald,
    fontWeight: "600",
  },

  // ========== 数据日志（终端风格） ==========
  logSection: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  logHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  logHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
    letterSpacing: 0.4,
  },
  logCount: {
    fontSize: 12,
    color: Colors.slate,
    fontWeight: "600",
    backgroundColor: Colors.ringBg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  clearLogText: {
    color: Colors.red,
    fontSize: 12,
    fontWeight: "600",
  },
  logContainer: {
    backgroundColor: Colors.slateDark,
    borderRadius: Radius.md,
    padding: 14,
    maxHeight: 360,
  },
  logEmpty: {
    color: Colors.slate,
    textAlign: "center",
    paddingVertical: 24,
    fontSize: 13,
    lineHeight: 20,
  },
  logEntry: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  logMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  logDirection: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  logTime: {
    fontSize: 10,
    color: Colors.slate,
    fontFamily: "monospace",
  },
  logRaw: {
    fontSize: 13,
    color: Colors.lightStone,
    fontFamily: "monospace",
    marginBottom: 4,
  },
  logParsed: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  logParsedItem: {
    fontSize: 11,
    color: "#34D399",
    fontFamily: "monospace",
  },

  // ========== 重连界面 ==========
  reconnectContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  reconnectTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.text,
    marginTop: 20,
  },
  reconnectDetail: {
    fontSize: 15,
    color: Colors.electric,
    marginTop: 8,
    fontWeight: "500",
  },
  reconnectDevice: {
    fontSize: 13,
    color: Colors.slate,
    marginTop: 6,
    fontFamily: "monospace",
  },
  reconnectCancelBtn: {
    marginTop: 32,
    paddingHorizontal: 28,
    paddingVertical: 12,
    backgroundColor: Colors.red,
    borderRadius: Radius.md,
  },
  reconnectCancelText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "600",
  },
});
