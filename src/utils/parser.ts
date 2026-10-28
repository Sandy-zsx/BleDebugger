/**
 * 智能浇水控制器 — 数据解析工具
 *
 * 协议说明（CLAUDE.md + 新版单片机固件）：
 * - 通信方式：SPP 串口仿真，纯文本字符串
 * - 指令结尾：\r\n（固件中断以 \n 或 \r 作终止，兼容单 \n）
 * - 大小写：指令全大写
 *
 * 新固件主要变化：
 * - STATUS 响应字段 HUM: → Humidity:，并新增 Alarm:ACTIVE/NONE
 * - 上报指令 REPORT_START/STOP → REPORT_TOGGLE
 * - 新增指令 PUMP_TOGGLE、RESET_ALARM
 * - 新增报警消息 ERROR: WATER_OUT / ALERT: ... / ALARM cleared ...
 */

/** 解析后的设备状态 */
export interface DeviceState {
  /** 土壤湿度百分比 (0-100)，未解析到时为 null */
  humidity: number | null;
  /** 当前模式 */
  mode: "Auto" | "Manual" | null;
  /** 水泵状态 */
  pump: "ON" | "OFF" | null;
  /** ADC 原始值，未解析到时为 null */
  adc: number | null;
  /** 报警状态（ACTIVE=缺水/故障报警中，NONE=无报警） */
  alarm: "ACTIVE" | "NONE" | null;
  /** 原始响应文本 */
  raw: string;
}

/** 数据日志条目 */
export interface LogEntry {
  id: number;
  timestamp: Date;
  direction: "send" | "receive";
  raw: string;
  parsed?: Partial<DeviceState>;
}

/** 报警消息解析结果 */
export interface AlarmParseResult {
  /** 报警事件：active=进入报警，cleared=报警已清除，none=当前无报警 */
  event: "active" | "cleared" | "none" | null;
  /** 人类可读提示，event 为 null 时为 null */
  message: string | null;
}

/**
 * 解析 STATUS 响应。
 *
 * 示例（新固件）：
 *   "Humidity:84%,Mode:Auto,Pump:OFF,Alarm:NONE"
 *     → { humidity: 84, mode: "Auto", pump: "OFF", alarm: "NONE" }
 * 旧固件：
 *   "HUM:35%,Mode:Manual,Pump:ON" → { humidity: 35, mode: "Manual", pump: "ON" }
 */
export function parseStatusResponse(raw: string): Partial<DeviceState> {
  const result: Partial<DeviceState> = { raw };

  // 湿度 Humidity:84%（新）或 HUM:84%（旧 / ADC 响应）
  const humMatch = raw.match(/(?:Humidity|HUM)\s*:\s*(\d+)\s*%/i);
  if (humMatch) {
    result.humidity = parseInt(humMatch[1], 10);
  }

  // 模式 Mode:Auto 或 Mode:Manual
  const modeMatch = raw.match(/Mode\s*:\s*(Auto|Manual)/i);
  if (modeMatch) {
    result.mode = modeMatch[1] as "Auto" | "Manual";
  }

  // 泵 Pump:ON 或 Pump:OFF
  const pumpMatch = raw.match(/Pump\s*:\s*(ON|OFF)/i);
  if (pumpMatch) {
    result.pump = pumpMatch[1] as "ON" | "OFF";
  }

  // 报警 Alarm:ACTIVE 或 Alarm:NONE
  const alarmMatch = raw.match(/Alarm\s*:\s*(ACTIVE|NONE)/i);
  if (alarmMatch) {
    result.alarm = alarmMatch[1].toUpperCase() as "ACTIVE" | "NONE";
  }

  return result;
}

/**
 * 解析 ADC 响应。
 *
 * 示例：
 *   "ADC:1532,HUM:84%" → { adc: 1532, humidity: 84 }
 */
export function parseAdcResponse(raw: string): Partial<DeviceState> {
  const result: Partial<DeviceState> = { raw };

  // ADC 原始值
  const adcMatch = raw.match(/ADC\s*:\s*(\d+)/i);
  if (adcMatch) {
    result.adc = parseInt(adcMatch[1], 10);
  }

  // 湿度 HUM:84%（ADC 响应仍用旧字段名，这里同样兼容 Humidity）
  const humMatch = raw.match(/(?:Humidity|HUM)\s*:\s*(\d+)\s*%/i);
  if (humMatch) {
    result.humidity = parseInt(humMatch[1], 10);
  }

  return result;
}

/**
 * 解析泵操作响应。
 *
 * 示例：
 *   "PUMP_ON OK"         → 成功开启
 *   "PUMP_ON rejected: soil is wet" → 被拒绝（土壤已湿）
 *   "PUMP_ON rejected: ALARM active" → 被拒绝（报警中）
 *   "PUMP_OFF OK"        → 成功关闭
 *   "PUMP_TOGGLE OK"     → 切换成功
 */
export function parsePumpResponse(raw: string): {
  command: "PUMP_ON" | "PUMP_OFF" | "PUMP_TOGGLE" | null;
  success: boolean;
  reason: string | null;
} {
  const upper = raw.toUpperCase().trim();

  const isPumpOn = upper.includes("PUMP_ON");
  const isPumpOff = upper.includes("PUMP_OFF");
  const isPumpToggle = upper.includes("PUMP_TOGGLE");

  if (!isPumpOn && !isPumpOff && !isPumpToggle) {
    return { command: null, success: false, reason: null };
  }

  const command = isPumpToggle ? "PUMP_TOGGLE" : isPumpOn ? "PUMP_ON" : "PUMP_OFF";
  const success = upper.includes("OK") && !upper.includes("REJECTED");
  const reasonMatch = raw.match(/rejected?\s*:?\s*(.+)/i);
  const reason = reasonMatch ? reasonMatch[1].trim() : null;

  return { command, success, reason };
}

/**
 * 解析报警相关消息。
 *
 * 示例：
 *   "ERROR: WATER_OUT"                     → active
 *   "ALERT: No water or pump fault!"       → active
 *   "ALERT: Auto-cleared, soil is wet now" → cleared
 *   "ALARM cleared remotely"               → cleared
 *   "No active alarm"                      → none
 */
export function parseAlarmResponse(raw: string): AlarmParseResult {
  const upper = raw.toUpperCase();

  if (
    upper.includes("ERROR: WATER_OUT") ||
    upper.includes("NO WATER OR PUMP FAULT")
  ) {
    return { event: "active", message: "缺水/水泵故障，已进入报警" };
  }

  if (upper.includes("AUTO-CLEARED") || upper.includes("ALARM CLEARED")) {
    return { event: "cleared", message: "报警已清除" };
  }

  if (upper.includes("NO ACTIVE ALARM")) {
    return { event: "none", message: "当前无报警" };
  }

  return { event: null, message: null };
}

/**
 * 通用响应解析——尝试从任意文本中提取已知信息。
 */
export function parseResponse(raw: string): Partial<DeviceState> {
  // 优先按 STATUS 格式解析
  const statusResult = parseStatusResponse(raw);

  // 如果有 humidity/mode/pump/alarm 中的任何一个，说明确实是 STATUS 格式
  if (
    statusResult.humidity != null ||
    statusResult.mode ||
    statusResult.pump ||
    statusResult.alarm
  ) {
    return statusResult;
  }

  // 尝试 ADC 格式
  const adcResult = parseAdcResponse(raw);
  if (adcResult.adc != null || adcResult.humidity != null) {
    return adcResult;
  }

  // 都匹配不上，返回原始数据
  return { raw };
}

/**
 * 构建发送指令（自动添加换行结尾）。
 */
export function buildCommand(cmd: string): string {
  return cmd.trim() + "\n";
}

/** 可用指令列表 */
export const COMMANDS = {
  PUMP_ON: "PUMP_ON",
  PUMP_OFF: "PUMP_OFF",
  PUMP_TOGGLE: "PUMP_TOGGLE",
  AUTO: "AUTO",
  STATUS: "STATUS",
  ADC: "ADC?",
  REPORT_TOGGLE: "REPORT_TOGGLE",
  RESET_ALARM: "RESET_ALARM",
} as const;
