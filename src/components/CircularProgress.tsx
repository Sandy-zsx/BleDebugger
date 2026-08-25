import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { getHumidityColor, Colors } from "../theme";

interface CircularProgressProps {
  /** 湿度百分比 (0-100)，为 null 时显示 "--" */
  value: number | null;
  /** 圆形直径，默认 200 */
  size?: number;
  /** 环形宽度，默认 14 */
  strokeWidth?: number;
}

/**
 * 圆形湿度进度环（纯 RN View 实现）。
 *
 * 颜色规则（从 theme 派生）：
 * - 🔵 ≥ 60%：电光蓝（健康）
 * - 🟡 30-59%：琥珀（关注）
 * - 🔴 < 30%：红（危急）
 * - ⚪ null：浅石（无数据）
 */
export default function CircularProgress({
  value,
  size = 200,
  strokeWidth = 14,
}: CircularProgressProps) {
  const radius = size / 2;
  const innerSize = size - strokeWidth * 2;
  const color = getHumidityColor(value);

  // 将 0-100 转为 0-360 度，并限制范围
  const percentage = value != null ? Math.min(100, Math.max(0, value)) : 0;
  const degrees = (percentage / 100) * 360;

  // 左半圆（0° – 180°），右半圆（180° – 360°）
  const leftDegrees = Math.min(180, degrees);
  const rightDegrees = Math.max(0, degrees - 180);

  return (
    <View style={[styles.wrapper, { width: size, height: size }]}>
      {/* 背景灰环 */}
      <View
        style={[
          styles.bgCircle,
          {
            width: size,
            height: size,
            borderRadius: radius,
            borderWidth: strokeWidth,
            borderColor: Colors.ringBg,
          },
        ]}
      />

      {/* 左半圆裁剪区域（显示 0% – 50%） */}
      <View
        style={[
          styles.clipHalf,
          {
            width: radius,
            height: size,
            left: 0,
          },
        ]}
      >
        <View
          style={[
            styles.clipInner,
            {
              width: size,
              height: size,
              borderRadius: radius,
              borderWidth: strokeWidth,
              borderColor: color,
              transform: [
                { rotate: `${-180 + leftDegrees}deg` },
              ],
            },
          ]}
        />
      </View>

      {/* 右半圆裁剪区域（显示 50% – 100%） */}
      <View
        style={[
          styles.clipHalf,
          {
            width: radius,
            height: size,
            left: radius,
          },
        ]}
      >
        <View
          style={[
            styles.clipInner,
            {
              width: size,
              height: size,
              borderRadius: radius,
              borderWidth: strokeWidth,
              borderColor: color,
              // 圆心在裁剪区左边 → left: -radius
              left: -radius,
              transform: [
                { rotate: `${rightDegrees}deg` },
              ],
            },
          ]}
        />
      </View>

      {/* 中心文字 */}
      <View
        style={[
          styles.centerContent,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            top: strokeWidth,
            left: strokeWidth,
          },
        ]}
      >
        {value != null ? (
          <>
            <Text style={[styles.valueText, { color }]}>{value}</Text>
            <Text style={styles.unitText}>%</Text>
          </>
        ) : (
          <Text style={styles.noDataText}>--</Text>
        )}
        <Text style={styles.labelText}>土壤湿度</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
  },
  bgCircle: {
    position: "absolute",
  },
  clipHalf: {
    position: "absolute",
    top: 0,
    overflow: "hidden",
  },
  clipInner: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  centerContent: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.bg,
  },
  valueText: {
    fontSize: 56,
    fontWeight: "800",
    lineHeight: 60,
  },
  unitText: {
    fontSize: 18,
    color: Colors.slate,
    fontWeight: "500",
    marginTop: 2,
  },
  noDataText: {
    fontSize: 48,
    color: Colors.lightStone,
    fontWeight: "700",
  },
  labelText: {
    fontSize: 12,
    color: Colors.slate,
    marginTop: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
