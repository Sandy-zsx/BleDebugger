import React, { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import RNBluetoothClassic, {
  type BluetoothNativeDevice,
  type BluetoothDeviceEvent,
  type StandardOptions,
} from "react-native-bluetooth-classic";
import {
  requestBluetoothPermissions,
  checkBluetoothPermissions,
} from "./src/utils/permissions";
import ControlPanel from "./src/pages/ControlPanel";
import { Colors, Radius, Spacing } from "./src/theme";

/**
 * 蓝牙设备扫描主界面
 *
 * 功能：
 * - 扫描附近的经典蓝牙 (SPP) 设备
 * - 显示已发现的设备列表
 * - 显示蓝牙连接状态
 * - 连接/断开设备
 */

/** HC-05 SPP 连接选项 */
const CONNECTION_OPTIONS: StandardOptions = {
  delimiter: "\n",
  secureSocket: false,
  charset: "ascii",
};

export default function App() {
  const [devices, setDevices] = useState<BluetoothNativeDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [connectedDevice, setConnectedDevice] =
    useState<BluetoothNativeDevice | null>(null);
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  // ---- 初始化：检查权限和蓝牙状态 ----
  useEffect(() => {
    initBluetooth();
  }, []);

  const initBluetooth = async () => {
    // 1. 检查权限
    const alreadyGranted = await checkBluetoothPermissions();
    if (!alreadyGranted) {
      const granted = await requestBluetoothPermissions();
      if (!granted) {
        Alert.alert("权限不足", "蓝牙和位置权限是扫描设备所必需的。");
        return;
      }
    }

    // 2. 检查蓝牙是否开启
    try {
      const enabled = await RNBluetoothClassic.isBluetoothEnabled();
      setBluetoothEnabled(enabled);

      if (!enabled) {
        const requested = await RNBluetoothClassic.requestBluetoothEnabled();
        setBluetoothEnabled(requested);
        if (!requested) {
          Alert.alert("蓝牙未开启", "请开启蓝牙后再扫描设备。");
        }
      }
    } catch (error) {
      console.error("初始化蓝牙失败：", error);
      Alert.alert("错误", "无法访问蓝牙适配器，请确认设备支持蓝牙。");
    }
  };

  // ---- 监听蓝牙状态变化 ----
  useEffect(() => {
    const onEnabledSub = RNBluetoothClassic.onBluetoothEnabled(() => {
      setBluetoothEnabled(true);
    });
    const onDisabledSub = RNBluetoothClassic.onBluetoothDisabled(() => {
      setBluetoothEnabled(false);
      setConnectedDevice(null);
      setDevices([]);
      setIsScanning(false);
    });

    return () => {
      onEnabledSub.remove();
      onDisabledSub.remove();
    };
  }, []);

  // ---- 监听设备发现 ----
  useEffect(() => {
    const onDiscoveredSub = RNBluetoothClassic.onDeviceDiscovered(
      (event: BluetoothDeviceEvent) => {
        const device = event.device;
        setDevices((prev) => {
          const exists = prev.find((d) => d.address === device.address);
          if (exists) {
            return prev.map((d) =>
              d.address === device.address
                ? { ...d, rssi: device.rssi }
                : d
            );
          }
          return [...prev, device];
        });
      }
    );

    return () => {
      onDiscoveredSub.remove();
    };
  }, []);

  // ---- 扫描设备 ----
  const startScan = async () => {
    if (isScanning) return;

    if (!bluetoothEnabled) {
      Alert.alert("蓝牙未开启", "请先开启蓝牙。");
      return;
    }

    const hasPermission = await checkBluetoothPermissions();
    if (!hasPermission) {
      const granted = await requestBluetoothPermissions();
      if (!granted) {
        Alert.alert("权限不足", "需要蓝牙和位置权限才能扫描设备。");
        return;
      }
    }

    try {
      setDevices([]);
      setIsScanning(true);
      await RNBluetoothClassic.startDiscovery();
    } catch (error) {
      console.error("开始扫描失败：", error);
      setIsScanning(false);
      Alert.alert("扫描失败", "无法开始蓝牙扫描，请重试。");
    }
  };

  const stopScan = async () => {
    try {
      await RNBluetoothClassic.cancelDiscovery();
    } catch (error) {
      console.error("停止扫描失败：", error);
    } finally {
      setIsScanning(false);
    }
  };

  // ---- 连接设备 ----
  const connectToDevice = useCallback(
    async (device: BluetoothNativeDevice) => {
      try {
        if (isScanning) {
          await stopScan();
        }

        setConnecting(device.address);
        const connected = await RNBluetoothClassic.connectToDevice(
          device.address,
          CONNECTION_OPTIONS
        );
        setConnectedDevice(connected);
      } catch (error) {
        console.error("连接失败：", error);
        Alert.alert(
          "连接失败",
          `无法连接到 ${device.name || device.address}\n\n请确认：\n1. 设备是否已配对\n2. 设备是否在通信范围内\n3. 设备是否正在被其他应用使用`
        );
      } finally {
        setConnecting(null);
      }
    },
    [isScanning]
  );

  // ---- 渲染设备列表项 ----
  const renderDeviceItem = ({ item }: { item: BluetoothNativeDevice }) => {
    const isConnecting = connecting === item.address;

    return (
      <TouchableOpacity
        style={[styles.deviceItem, isConnecting && styles.deviceItemConnecting]}
        onPress={() => connectToDevice(item)}
        activeOpacity={0.7}
        disabled={connecting != null}
      >
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName} numberOfLines={1}>
            {item.name || "未知设备"}
          </Text>
          <Text style={styles.deviceAddress}>{item.address}</Text>
        </View>
        <View style={styles.deviceMeta}>
          {item.rssi != null && Number(item.rssi) !== 0 && (
            <View style={styles.rssiTag}>
              <Text style={styles.rssiText}>{String(item.rssi)} dBm</Text>
            </View>
          )}
          {isConnecting ? (
            <ActivityIndicator color={Colors.electric} size="small" />
          ) : (
            <Text style={styles.connectHint}>连接 →</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ---- 如果已连接，显示控制面板 ----
  if (connectedDevice) {
    return (
      <ControlPanel
        device={connectedDevice}
        onDisconnect={() => setConnectedDevice(null)}
        onBack={() => {
          RNBluetoothClassic.disconnectFromDevice(
            connectedDevice.address
          ).catch(() => {});
          setConnectedDevice(null);
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* 标题栏 */}
      <View style={styles.header}>
        <Text style={styles.title}>智能浇水控制器</Text>
        <Text style={styles.subtitle}>蓝牙调试助手</Text>
      </View>

      {/* 连接状态指示器 */}
      <View style={styles.statusBar}>
        <View style={styles.statusDotOuter}>
          <View
            style={[
              styles.statusDot,
              bluetoothEnabled ? styles.statusOn : styles.statusOff,
            ]}
          />
        </View>
        <View style={styles.statusTextGroup}>
          <Text style={styles.statusText}>
            {bluetoothEnabled ? "蓝牙已开启" : "蓝牙未开启"}
          </Text>
          <Text style={styles.statusHint}>
            {bluetoothEnabled
              ? "可以扫描附近的蓝牙设备"
              : "请在系统设置中开启蓝牙"}
          </Text>
        </View>
      </View>

      {/* 扫描按钮 */}
      <TouchableOpacity
        style={[styles.scanButton, isScanning && styles.scanButtonActive]}
        onPress={isScanning ? stopScan : startScan}
        activeOpacity={0.85}
        disabled={!bluetoothEnabled}
      >
        {isScanning ? (
          <>
            <ActivityIndicator color={Colors.white} size="small" />
            <Text style={styles.scanButtonText}>停止扫描</Text>
          </>
        ) : (
          <Text style={styles.scanButtonText}>
            {bluetoothEnabled ? "扫描设备" : "蓝牙未开启"}
          </Text>
        )}
      </TouchableOpacity>

      {/* 设备列表 */}
      <View style={styles.listContainer}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>附近的设备</Text>
          {devices.length > 0 && (
            <View style={styles.listCountBadge}>
              <Text style={styles.listCountText}>{devices.length}</Text>
            </View>
          )}
        </View>

        <FlatList
          data={devices}
          keyExtractor={(item) => item.address}
          renderItem={renderDeviceItem}
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <Text style={styles.emptyIcon}>
                {bluetoothEnabled ? "📡" : "🔇"}
              </Text>
              <Text style={styles.emptyTitle}>
                {bluetoothEnabled ? "暂无设备" : "蓝牙未开启"}
              </Text>
              <Text style={styles.emptyText}>
                {bluetoothEnabled
                  ? "点击上方按钮开始扫描附近的蓝牙设备"
                  : "请先开启蓝牙后再扫描设备"}
              </Text>
            </View>
          }
          contentContainerStyle={
            devices.length === 0 ? styles.emptyContainer : styles.listContent
          }
        />
      </View>
    </View>
  );
}

// ---- 样式 ----
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },

  // ========== 标题栏 ==========
  header: {
    paddingTop: Platform.OS === "android" ? 48 : 60,
    paddingBottom: 20,
    paddingHorizontal: 24,
    backgroundColor: Colors.text,
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.white,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.lightStone,
    marginTop: 4,
    letterSpacing: 0.5,
  },

  // ========== 状态指示 ==========
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.white,
    marginHorizontal: 20,
    marginTop: -10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: Radius.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  statusDotOuter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bg,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  statusDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  statusOn: {
    backgroundColor: Colors.emerald,
  },
  statusOff: {
    backgroundColor: Colors.lightStone,
  },
  statusTextGroup: {
    flex: 1,
  },
  statusText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
  },
  statusHint: {
    fontSize: 12,
    color: Colors.slate,
    marginTop: 2,
  },

  // ========== 扫描按钮 ==========
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 20,
    marginTop: 20,
    paddingVertical: 16,
    backgroundColor: Colors.brand,
    borderRadius: Radius.lg,
    gap: 8,
    shadowColor: Colors.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  scanButtonActive: {
    backgroundColor: Colors.red,
    shadowColor: Colors.red,
  },
  scanButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "600",
  },

  // ========== 设备列表 ==========
  listContainer: {
    flex: 1,
    marginTop: 20,
    paddingHorizontal: 20,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
    letterSpacing: 0.4,
  },
  listCountBadge: {
    backgroundColor: Colors.electric,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  listCountText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.white,
  },
  listContent: {
    paddingBottom: 20,
  },
  deviceItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.white,
    padding: 16,
    borderRadius: Radius.md,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  deviceItemConnecting: {
    borderWidth: 1.5,
    borderColor: Colors.electric,
    backgroundColor: Colors.lightBlue,
  },
  deviceInfo: {
    flex: 1,
    marginRight: 12,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
  },
  deviceAddress: {
    fontSize: 12,
    color: Colors.slate,
    marginTop: 3,
    fontFamily: "monospace",
  },
  deviceMeta: {
    alignItems: "flex-end",
    gap: 6,
  },
  rssiTag: {
    backgroundColor: Colors.bg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  rssiText: {
    fontSize: 11,
    color: Colors.slate,
    fontFamily: "monospace",
  },
  connectHint: {
    fontSize: 11,
    color: Colors.lightStone,
    fontWeight: "500",
  },

  // ========== 空列表 ==========
  emptyContainer: {
    flexGrow: 1,
  },
  emptyList: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.slate,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 32,
  },
});
