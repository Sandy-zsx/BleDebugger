import React, { useEffect, useRef } from "react";
import { Animated, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Colors } from "../theme";

export interface ToastMessage {
  id: number;
  text: string;
  type: "info" | "success" | "warning" | "error";
}

interface ToastProps {
  message: ToastMessage | null;
  duration?: number;
  onDismiss: () => void;
}

const TOAST_COLORS = {
  info: { bg: Colors.brand, text: Colors.white },
  success: { bg: Colors.emerald, text: Colors.white },
  warning: { bg: Colors.amber, text: Colors.text },
  error: { bg: Colors.red, text: Colors.white },
} as const;

/**
 * 轻量级 Toast 通知组件。
 *
 * 从顶部滑入，自动消失，点击可立即关闭。
 */
export default function Toast({ message, duration = 3000, onDismiss }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-60)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!message) {
      opacity.setValue(0);
      translateY.setValue(-60);
      return;
    }

    // 入场动画
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();

    // 自动消失
    timerRef.current = setTimeout(() => {
      dismiss();
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [message?.id]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -60,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  };

  if (!message) return null;

  const colors = TOAST_COLORS[message.type];

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: colors.bg,
          opacity,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity onPress={dismiss} activeOpacity={0.9} style={styles.touch}>
        <Text style={[styles.text, { color: colors.text }]} numberOfLines={2}>
          {message.text}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 54,
    left: 20,
    right: 20,
    borderRadius: 14,
    zIndex: 9999,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  touch: {
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  text: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
