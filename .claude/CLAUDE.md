# 项目：智能浇水控制器 — 蓝牙调试助手 (SmartWateringBLE)

## 📱 项目概述
开发一个手机 App，通过蓝牙（HC-05 SPP）连接嵌入式智能浇水系统，实现：
- 实时查看土壤湿度
- 远程控制水泵
- 调整和控制工作模式（手动/自动）

## 🛠️ 技术栈
- **框架**：React Native (Expo SDK 57)
- **语言**：TypeScript
- **蓝牙库**：react-native-bluetooth-classic（⚠️ 注意：不是 BLE 库）
- **目标平台**：Android 优先（iOS 对 SPP 支持有限）

## 🔗 蓝牙通信协议（基于 HC-05 SPP）

### 通信方式
- **协议**：SPP（串口仿真协议）
- **数据格式**：纯文本字符串（不是 JSON/二进制）
- **指令结尾**：以换行结尾（`\r\n` 或 `\n`，固件中断按 `\n`/`\r` 终止）
- **大小写**：严格区分大小写（指令全部大写）

### 指令集（从手机 → HC-05）

| 指令 | 功能 | 预期响应示例 |
|------|------|-------------|
| `PUMP_ON` | 手动开泵 | `PUMP_ON OK` / `PUMP_ON rejected: soil is wet` / `PUMP_ON rejected: ALARM active` |
| `PUMP_OFF` | 手动关泵 | `PUMP_OFF OK` |
| `PUMP_TOGGLE` | 切换水泵（主要供小机器人使用） | `PUMP_TOGGLE OK` |
| `AUTO` | 切回自动模式 | `Switched to AUTO mode` / `AUTO rejected: ALARM active` |
| `STATUS` | 查询当前状态 | `Humidity:84%,Mode:Auto,Pump:OFF,Alarm:NONE` |
| `ADC?` | 查询原始 ADC 和湿度 | `ADC:1532,HUM:84%`（⚠️ 此处仍用 `HUM`，非 `Humidity`） |
| `REPORT_TOGGLE` | 切换自动上报（每2秒） | `Auto report STARTED` / `Auto report STOPPED` |
| `RESET_ALARM` | 远程清除报警 | `ALARM cleared remotely` / `No active alarm` |
| `EN_AT` | 进入 AT 模式（2秒后自动退出） | `Entered AT mode` → `Back to normal mode` |

### 数据解析规则
- 湿度值：从 `Humidity:84%`（新）或 `HUM:84%`（旧 / `ADC?` 响应）解析出 `84`
- 模式：`Mode:Auto` 或 `Mode:Manual`
- 泵状态：`Pump:ON` 或 `Pump:OFF`
- 报警状态：`Alarm:ACTIVE`（报警中）或 `Alarm:NONE`（无报警）
- 其他未知响应：显示原始数据

### 报警状态机（新增）
- **触发**：水泵连续运行 30 秒仍未抽到水（`PUMP_TIMEOUT`）→ 停泵 + 蜂鸣 + LED 红闪，发送
  `ERROR: WATER_OUT` 与 `ALERT: No water or pump fault!`
- **自动解除**：土壤变湿（ADC < 湿阈值）后自动清除，发送 `ALERT: Auto-cleared, soil is wet now`
- **远程解除**：发送 `RESET_ALARM` → `ALARM cleared remotely`；无报警时 → `No active alarm`
- **报警期间**：`PUMP_ON` / `AUTO` 被拒绝（`rejected: ALARM active`）

### 连接与自动上报（新增行为）
- 手机连接瞬间，固件自动开启上报并发 `Auto report STARTED (phone connected)`
- 连接 2 秒后固件自动推一次 `STATUS`，用于刷新 App 主界面
- 手动模式 10 秒后自动切回自动（`MANUAL_TIMEOUT`）

## 🎨 界面设计需求

### 主页面（设备扫描 + 连接）
- 标题：智能浇水控制器 🌱
- 搜索设备按钮（扫描附近的 SPP 设备）
- 设备列表（显示设备名称和 MAC 地址）
- 连接/断开按钮
- 连接状态指示器（已连接/未连接）

### 控制页面（连接后自动进入）
布局从上到下：

1. **状态信息卡片**
   - 当前湿度：XX%（环形进度条或圆盘显示）
   - 当前模式：自动/手动（带图标）
   - 水泵状态：开/关（带颜色指示灯）
   - MAC 地址和连接状态

2. **浇水控制区**
   - 手动浇水按钮（大圆形按钮，带水滴 💧 图标）
   - 点击后发送 `PUMP_ON`
   - 再次点击发送 `PUMP_OFF`
   - 按钮状态显示当前泵状态

3. **模式切换区**
   - 自动模式按钮（发送 `AUTO`）
   - 手动模式按钮（提示切换，由 STM32 决定）
   - 当前模式高亮显示

4. **调试/数据区**
   - 查询状态按钮（发送 `STATUS`）
   - 查询 ADC 按钮（发送 `ADC?`）
   - 数据日志显示（显示收到的原始数据和解析结果）
   - 清空日志按钮

5. **自动上报控制**（可选）
   - 切换上报按钮（发送 `REPORT_TOGGLE`）
   - 上报频率显示：2秒/次
   - 报警时显示红色告警卡 +「重置报警」按钮（发送 `RESET_ALARM`）

### 配色方案
- 主色：品牌蓝 #1E40AF + 电光蓝 #3B82F6（交互元素、湿度环填充）
- 湿度显示：电光蓝（≥60% 湿润）→ 琥珀 #F59E0B（30-59% 适中）→ 红 #EF4444（<30% 干燥）
- 水泵状态：翠绿 #10B981（开）/ 浅石 #94A3B8（关）
- 背景色：#F0F4F8

## 📋 核心功能清单
- [ ] 蓝牙设备扫描（SPP 设备）
- [ ] 连接 HC-05（配对 + 建立串口连接）
- [ ] 发送指令（支持上述所有指令）
- [ ] 接收并解析数据（状态、湿度、ADC、报警等）
- [ ] 手动控制水泵（开/关）
- [ ] 切换自动模式
- [ ] 查询状态（手动刷新）
- [ ] 自动上报数据（每2秒接收并更新 UI，支持 REPORT_TOGGLE 切换）
- [ ] 报警展示（告警卡 + 重置报警 RESET_ALARM）
- [ ] 断开连接
- [ ] 数据日志（显示所有收发记录）

## 🔧 错误处理
- 蓝牙未开启 → 提示用户开启蓝牙
- 连接失败 → 重试 + 友好提示
- 指令发送失败 → 显示错误信息
- 数据解析异常 → 显示原始数据
- 设备报警（缺水/水泵故障）→ 红色告警卡 + Toast + 禁用水泵/AUTO，直到重置或土壤变湿自动解除

## 📚 核心参考文档
- 已保存 `docs/bluetooth-classic-wiki.md`（项目 Wiki）
- react-native-bluetooth-classic 官方文档：
  https://github.com/kenjdavidson/react-native-bluetooth-classic
- 重点 API：
  - BluetoothClassic.startDiscovery()
  - BluetoothClassic.connect(deviceId)
  - BluetoothClassic.writeToDevice(deviceId, data)
  - BluetoothClassic.addListener('dataReceived', callback)

## ⚠️ 平台限制
- **Android**：完美支持
- **iOS**：不支持 SPP（需要 MFI 认证，非常复杂）
- **开发建议**：只针对 Android 平台开发