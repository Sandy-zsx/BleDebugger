# 智能浇水控制器 · 蓝牙调试助手 🌱

一个基于 **React Native (Expo)** 的 Android 应用，通过**经典蓝牙 SPP（HC-05 串口模块）**连接嵌入式智能浇水系统，实现土壤湿度实时查看、水泵远程控制、工作模式切换与缺水报警监控。

> 注意：本项目使用 **经典蓝牙 SPP**（`react-native-bluetooth-classic`），**不是** BLE 低功耗蓝牙库。

---

## ✨ 功能特性

- 📡 **设备扫描** — 扫描附近经典蓝牙（SPP）设备，显示名称 / MAC / 信号强度
- 🔗 **连接 HC-05** — 配对 + 建立串口连接，自动请求蓝牙与定位权限
- 💧 **实时湿度** — 环形进度条显示，按湿度区间呈现语义色（湿润 / 适中 / 干燥）
- ⚙️ **手动控制水泵** — 一键开泵 / 关泵（`PUMP_ON` / `PUMP_OFF`）
- 🔁 **模式切换** — 自动 / 手动模式，`AUTO` 指令切回自动
- 📊 **状态查询** — 查询设备状态（`STATUS`）与原始 ADC（`ADC?`）
- ⏱️ **自动上报** — 每 2 秒自动刷新，可 `REPORT_TOGGLE` 开关
- 🚨 **报警监控** — 缺水 / 水泵故障红色告警，远程重置（`RESET_ALARM`）
- 🔄 **断线自动重连** — 指数退避重连（最多 5 次）
- 💓 **心跳保活** — 定期通信，防止 HC-05 空闲断开
- 📜 **数据日志** — 终端风格展示所有收发记录与解析结果

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React Native `0.86` · Expo SDK `57` |
| 语言 | TypeScript |
| 蓝牙库 | `react-native-bluetooth-classic`（经典蓝牙 SPP） |
| 目标平台 | **仅 Android**（iOS 不支持 SPP，需 MFI 认证） |

---

## 🔗 蓝牙通信协议（HC-05 SPP）

- **协议**：SPP 串口仿真，纯文本字符串（非 JSON / 二进制）
- **指令结尾**：换行 `\n`（固件以 `\n` / `\r` 终止，兼容单 `\n`）
- **大小写**：严格区分，指令全大写

### 指令集（手机 → HC-05）

| 指令 | 功能 | 预期响应示例 |
|------|------|-------------|
| `PUMP_ON` | 手动开泵 | `PUMP_ON OK` / `PUMP_ON rejected: soil is wet` / `PUMP_ON rejected: ALARM active` |
| `PUMP_OFF` | 手动关泵 | `PUMP_OFF OK` |
| `PUMP_TOGGLE` | 切换水泵 | `PUMP_TOGGLE OK` |
| `AUTO` | 切回自动模式 | `Switched to AUTO mode` / `AUTO rejected: ALARM active` |
| `STATUS` | 查询当前状态 | `Humidity:84%,Mode:Auto,Pump:OFF,Alarm:NONE` |
| `ADC?` | 查询原始 ADC 与湿度 | `ADC:1532,HUM:84%`（仍用 `HUM` 字段） |
| `REPORT_TOGGLE` | 切换自动上报（每 2 秒） | `Auto report STARTED` / `Auto report STOPPED` |
| `RESET_ALARM` | 远程清除报警 | `ALARM cleared remotely` / `No active alarm` |
| `EN_AT` | 进入 AT 模式（2 秒后退出） | `Entered AT mode` → `Back to normal mode` |

### 数据解析规则

- **湿度**：从 `Humidity:84%`（新）或 `HUM:84%`（旧 / `ADC?` 响应）解析出 `84`
- **模式**：`Mode:Auto` 或 `Mode:Manual`
- **泵状态**：`Pump:ON` 或 `Pump:OFF`
- **报警**：`Alarm:ACTIVE`（报警中）或 `Alarm:NONE`（无报警）
- **其他响应**：原样显示原始数据

### 报警状态机

- **触发**：水泵连续运行 30 秒未抽到水 → 停泵 + 蜂鸣 + LED 红闪，下发 `ERROR: WATER_OUT` 与 `ALERT: No water or pump fault!`
- **自动解除**：土壤变湿（ADC < 湿阈值）→ `ALERT: Auto-cleared, soil is wet now`
- **远程解除**：`RESET_ALARM` → `ALARM cleared remotely`
- **报警期间**：`PUMP_ON` / `AUTO` 被拒绝

---

## 📂 项目结构

```
BleDebugger/
├── App.tsx                          # 入口：设备扫描 + 连接主界面
├── index.ts                         # registerRootComponent 入口
├── app.config.js                    # Expo 配置（含蓝牙权限、包名）
├── eas.json                         # EAS Build 配置
├── src/
│   ├── pages/
│   │   └── ControlPanel.tsx         # 连接后的控制面板
│   ├── components/
│   │   ├── CircularProgress.tsx     # 湿度环形进度条
│   │   └── Toast.tsx                # 轻提示
│   ├── hooks/
│   │   └── useReconnect.ts          # 断线自动重连（指数退避）
│   ├── utils/
│   │   ├── parser.ts                # 协议解析 + 指令构建
│   │   └── permissions.ts           # Android 运行时权限
│   └── theme.ts                     # 全局主题（配色 / 字号 / 间距）
├── assets/                          # 图标 / 启动图
├── docs/
│   └── bluetooth-classic-wiki.md    # 项目 Wiki 参考
├── package.json
└── tsconfig.json
```

> `android/` 为 **`expo prebuild` 生成的本地工程**，已由 `.gitignore` 忽略，不纳入版本控制。

---

## 🚀 环境要求

- Node.js 18+（推荐 20+）
- Android Studio + Android SDK（用于编译原生工程）
- 一台 Android 真机（蓝牙功能无法在模拟器上完整测试）

---

## 📦 安装与运行

```bash
# 1. 安装依赖
npm install

# 2. 生成 Android 原生工程（首次运行 / android 目录被清理后）
npx expo prebuild --platform android

# 3. 编译并安装到真机（连接手机并开启 USB 调试）
npx expo run:android
```

> ⚠️ **无法在 Expo Go 中运行**：`react-native-bluetooth-classic` 是原生模块，必须通过 `expo run:android` 或 EAS Build 生成开发/正式包。

### EAS 构建（可选）

```bash
npm install -g eas-cli
eas build --platform android --profile production
```

---

## 🔐 权限说明

应用会根据 Android 系统版本动态请求所需权限：

- **Android 12+（API 31+）**：`BLUETOOTH_SCAN`、`BLUETOOTH_CONNECT`
- **Android 10-11（API 29-30）**：`ACCESS_FINE_LOCATION`（扫描蓝牙必需）
- **Android 6-9（API 23-28）**：`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`

---

## 🎨 界面配色

| 用途 | 色值 |
|------|------|
| 品牌蓝（主按钮 / 标题栏） | `#1E40AF` |
| 电光蓝（交互元素 / 湿度环） | `#3B82F6` |
| 翠绿（水泵开 / 湿度 ≥60%） | `#10B981` |
| 琥珀（湿度 30-59%） | `#F59E0B` |
| 警示红（湿度 <30% / 报警） | `#EF4444` |
| 背景色 | `#F0F4F8` |

---

## ⚠️ 已知限制

- **仅 Android**：iOS 不支持经典蓝牙 SPP（需 MFI 认证）
- **包名占位**：`app.config.js` 中 `com.yourcompany.bledebugger` 为默认占位包名，正式发布前需修改

---

## 📄 License

[MIT](./LICENSE)
