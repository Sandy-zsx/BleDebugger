/**
 * Aqua Console 主题常量
 *
 * 设计方向：蓝色科技 + 精密仪表盘
 * 每处颜色和字号皆由此文件派生，保证全应用视觉一致。
 */

// ---- 颜色 ----
export const Colors = {
  /** 主背景 — 冷调薄雾，替代泛用灰 #F5F7FA */
  bg: "#F0F4F8",
  /** 主文本 — 深海军蓝，非纯黑 */
  text: "#0F172A",
  /** 品牌蓝 — 标题栏、主按钮 */
  brand: "#1E40AF",
  /** 电光蓝 — 交互元素、湿度环填充（正常） */
  electric: "#3B82F6",
  /** 琥珀 — 湿度中等 30-59%、警告 */
  amber: "#F59E0B",
  /** 纯白 — 卡片、抬升表面 */
  white: "#FFFFFF",
  /** 翠绿 — 湿度良好 ≥60%、成功 */
  emerald: "#10B981",
  /** 警示红 — 湿度 <30%、水泵运行中、断开 */
  red: "#EF4444",
  /** 石板深 — 日志终端背景 */
  slateDark: "#1E293B",
  /** 石板灰 — 辅助文本、标签 */
  slate: "#64748B",
  /** 浅石 — 禁用态、占位符 */
  lightStone: "#94A3B8",
  /** 浅环 — 湿度环底色 */
  ringBg: "#E2E8F0",
  /** 半透明白 — 叠加层 */
  whiteOverlay: "rgba(255,255,255,0.15)",
  /** 浅蓝底 — 连接中状态 */
  lightBlue: "#DBEAFE",
} as const;

// ---- 字号层级 ----
export const TypeScale = {
  /** 湿度大数 */
  display: {
    fontSize: 56,
    fontWeight: "800" as const,
    lineHeight: 60,
  },
  /** 页面标题 */
  title: {
    fontSize: 22,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  /** 区域标题 */
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600" as const,
    letterSpacing: 0.4,
    textTransform: "uppercase" as const,
  },
  /** 正文/按钮 */
  body: {
    fontSize: 16,
    fontWeight: "500" as const,
  },
  /** 按钮大字 */
  bodyBold: {
    fontSize: 18,
    fontWeight: "700" as const,
  },
  /** 辅助说明 */
  caption: {
    fontSize: 12,
    fontWeight: "400" as const,
  },
  /** 数据/代码 */
  mono: {
    fontSize: 13,
    fontFamily: "monospace" as const,
  },
} as const;

// ---- 间距 ----
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// ---- 圆角 ----
export const Radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

// ---- 阴影（Android elevation） ----
export const Elevation = {
  card: 2,
  button: 4,
  toast: 8,
} as const;

/**
 * 根据湿度值返回语义色。
 * - ≥60%：电光蓝（健康）
 * - 30-59%：琥珀（关注）
 * - <30%：红（危急）
 * - null：浅石（无数据）
 */
export function getHumidityColor(value: number | null): string {
  if (value == null) return Colors.lightStone;
  if (value >= 60) return Colors.electric;
  if (value >= 30) return Colors.amber;
  return Colors.red;
}
