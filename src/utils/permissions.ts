import { PermissionsAndroid, Platform } from "react-native";

/**
 * Android 运行时需要请求的危险权限。
 *
 * 注意：
 * - BLUETOOTH / BLUETOOTH_ADMIN 是"普通权限"，安装时自动授予，无需运行时请求。
 * - Android 12+（API 31+）：BLUETOOTH_SCAN / BLUETOOTH_CONNECT 是危险权限，必须运行时请求。
 * - Android 10-11（API 29-30）：需要 ACCESS_FINE_LOCATION 才能扫描蓝牙。
 * - Android 6-9（API 23-28）：需要 ACCESS_COARSE_LOCATION 或 ACCESS_FINE_LOCATION。
 */

const ANDROID_12_BLUETOOTH_PERMISSIONS = [
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
] as const;

const LOCATION_PERMISSIONS = [
  PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
] as const;

/**
 * 返回当前 Android API Level，非 Android 平台返回 0。
 */
async function getAndroidApiLevel(): Promise<number> {
  if (Platform.OS !== "android") return 0;
  try {
    // PermissionsAndroid 本身不提供 API level，但我们可以通过
    // 尝试请求 Android 12 权限来判断——但这不太优雅。
    // 更可靠的方式是通过 DeviceInfo 或直接用 Platform.Version。
    const version = Platform.Version;
    if (typeof version === "number") {
      return version as number;
    }
    // Platform.Version 在某些情况下返回字符串 (如 "12")，转为数字
    return parseInt(String(version), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * 根据 Android API Level 确定需要请求的权限列表。
 */
type AndroidPermission = (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS];

function getRequiredPermissions(apiLevel: number): AndroidPermission[] {
  const permissions: AndroidPermission[] = [];

  // Android 6+ 需要位置权限用于蓝牙扫描
  if (apiLevel >= 23) {
    permissions.push(...LOCATION_PERMISSIONS);
  }

  // Android 12+ 新增蓝牙扫描/连接的危险权限
  if (apiLevel >= 31) {
    permissions.push(...ANDROID_12_BLUETOOTH_PERMISSIONS);
  }

  return permissions;
}

/**
 * 请求蓝牙相关的所有必需权限。
 *
 * @returns `true` 表示所有权限已授予，`false` 表示有权限被拒绝。
 */
export async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") {
    // iOS 不需要通过此机制请求权限（使用 External Accessory framework + Info.plist）
    console.warn("Permissions: 当前平台不是 Android，跳过运行时权限请求。");
    return true;
  }

  const apiLevel = await getAndroidApiLevel();
  const required = getRequiredPermissions(apiLevel);

  if (required.length === 0) {
    // API < 23，无需运行时权限
    return true;
  }

  try {
    const result = await PermissionsAndroid.requestMultiple(required);

    const allGranted = required.every(
      (perm) => result[perm] === PermissionsAndroid.RESULTS.GRANTED
    );

    if (!allGranted) {
      const denied = required.filter(
        (perm) => result[perm] !== PermissionsAndroid.RESULTS.GRANTED
      );
      console.warn("Permissions: 以下权限被拒绝：", denied);
    }

    return allGranted;
  } catch (error) {
    console.error("Permissions: 请求权限时出错：", error);
    return false;
  }
}

/**
 * 检查是否已授予所有必需的蓝牙权限。
 *
 * 当权限已被授予时返回 `true`，可用于跳过权限请求流程。
 */
export async function checkBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const apiLevel = await getAndroidApiLevel();
  const required = getRequiredPermissions(apiLevel);

  if (required.length === 0) return true;

  try {
    const grantedStates = await Promise.all(
      required.map((perm) => PermissionsAndroid.check(perm))
    );
    return grantedStates.every(Boolean);
  } catch {
    return false;
  }
}
