/**
 * 智能浇水控制器 — 数据解析工具
 *
 * 协议说明（来自 CLAUDE.md）：
 * - 通信方式：SPP 串口仿真，纯文本字符串
 * - 指令结尾：必须 \r\n
 * - 大小写：严格区分（全部大写）
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

/**
 * 解析 STATUS 响应。
 *
 * 示例：
 *   "HUM:84%,Mode:Auto,Pump:OFF" → { humidity: 84, mode: "Auto", pump: "OFF" }
 *   "HUM:35%,Mode:Manual,Pump:ON" → { humidity: 35, mode: "Manual", pump: "ON" }
 */
export function parseStatusResponse(raw: string): Partial<DeviceState> {
  const result: Partial<DeviceState> = { raw };

  // 湿度 HUM:84%
  const humMatch = raw.match(/HUM\s*:\s*(\d+)\s*%/i);
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

  // 湿度 HUM:84%
  const humMatch = raw.match(/HUM\s*:\s*(\d+)\s*%/i);
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
 *   "PUMP_OFF OK"        → 成功关闭
 */
export function parsePumpResponse(raw: string): {
  command: "PUMP_ON" | "PUMP_OFF" | null;
  success: boolean;
  reason: string | null;
} {
  const upper = raw.toUpperCase().trim();

  const isPumpOn = upper.includes("PUMP_ON");
  const isPumpOff = upper.includes("PUMP_OFF");

  if (!isPumpOn && !isPumpOff) {
    return { command: null, success: false, reason: null };
  }

  const command = isPumpOn ? "PUMP_ON" : "PUMP_OFF";
  const success = upper.includes("OK") && !upper.includes("REJECTED");
  const reasonMatch = raw.match(/rejected?\s*:?\s*(.+)/i);
  const reason = reasonMatch ? reasonMatch[1].trim() : null;

  return { command, success, reason };
}

/**
 * 通用响应解析——尝试从任意文本中提取已知信息。
 */
export function parseResponse(raw: string): Partial<DeviceState> {
  // 优先按 STATUS 格式解析
  const statusResult = parseStatusResponse(raw);

  // 如果有 humidity/mode/pump 中的任何一个，说明确实是 STATUS 格式
  if (statusResult.humidity != null || statusResult.mode || statusResult.pump) {
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
 * 构建发送指令（自动添加 \r\n 结尾）。
 */
export function buildCommand(cmd: string): string {
  return cmd.trim() + "\n";
}

/** 可用指令列表 */
export const COMMANDS = {
  PUMP_ON: "PUMP_ON",
  PUMP_OFF: "PUMP_OFF",
  AUTO: "AUTO",
  STATUS: "STATUS",
  ADC: "ADC?",
  REPORT_START: "REPORT_START",
  REPORT_STOP: "REPORT_STOP",
} as const;
