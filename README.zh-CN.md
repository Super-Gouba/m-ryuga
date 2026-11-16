# M-Ryuga

**本地优先的 VoIP 抓包取证工作台，用于 SIP / RTP 通话分析与质量诊断。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)](https://github.com/Super-Gouba/m-ryuga/releases)
[![Electron](https://img.shields.io/badge/Electron-33-47848F)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](README.md) · **简体中文**

打开一个 `pcap` / `pcapng` 文件，M-Ryuga 会把原始报文还原成可以回答问题的通话：谁打给谁、如何协商、
媒体何时开始、按了哪些键、为什么失败、以及这段通话实际听起来是什么样 —— 全程不上传任何数据。

所有解析都在本机完成。没有账号，没有遥测，没有云端处理。

---

## 功能

| 能力 | 说明 |
| --- | --- |
| **抓包支持** | PCAP / PCAPNG / CAP，多文件导入（对话框、拖拽、拖到程序图标），单文件最大 1 GiB |
| **SIP 分析** | 按 `Call-ID` 关联请求与响应、流序图、报文原文语法高亮、搜索与过滤 |
| **媒体分析** | RTP 流还原、双向 PCM/WAV 提取、波形、丢包、抖动、乱序与重复统计 |
| **DTMF 识别** | RFC 2833/4733、SIP `INFO`、带内音频三路独立识别并去重 |
| **通话概览** | 抓包信息、协议分布、通话摘要、按键序列、诊断结论、媒体统计集中在一页 |
| **实时抓包** | 集成 npcap / dumpcap，多网卡、BPF 过滤、分卷与循环模式、实时通话视图，**停止后自行决定保存或丢弃** |
| **离线转写** | 通过 [whisper.cpp](https://github.com/ggerganov/whisper.cpp) 与 GGML 模型进行可选的本机转写 |
| **导出** | 关联报文 PCAPNG、分方向 WAV、单文件 HTML 报告，支持号码与 IP 隐私遮蔽 |
| **双语界面** | 英文（默认）与简体中文，运行时随时切换 |
| **工作流** | 应用内检查 GitHub Releases 更新、可拖拽分栏、缩放快捷键、浅色专业主题 |

## 截图

> 欢迎把脱敏后的参考抓包放到 `docs/screenshots/`，便于我们发布界面截图。

## 安装

从 [**Releases**](https://github.com/Super-Gouba/m-ryuga/releases/latest) 下载最新构建：

| 版本 | 文件 | 说明 |
| --- | --- | --- |
| 安装版 | `M-Ryuga-Setup-<version>.exe` | 当前用户安装，创建桌面与开始菜单快捷方式，含卸载程序 |
| 便携版 | `M-Ryuga-Portable-<version>.exe` | 单文件免安装，数据仍保存在 `%APPDATA%\M-Ryuga` |

适用于 Windows 10/11 x64。实时抓包还需要 [npcap](https://npcap.com/) 与 Wireshark 自带的 `dumpcap.exe`，
程序会自动检测并给出下载入口。

## 快速上手

1. 启动 M-Ryuga，把 `pcap` 文件拖到窗口任意位置。
2. 在左侧列表选择一通通话，自动打开流序图。
3. 点击 SIP 行查看报文原文；点击 **RTP** 行直接跳到试听并独听该方向。
4. 打开 **通话概览** 查看抓包信息、按键序列、诊断结论与媒体摘要。
5. 使用 **导出** 生成报文切片、WAV 或可分享的 HTML 报告。

## 隐私

* 解析、解码、诊断全部在本机完成。
* 音频不会上传；转写通过本机的可执行文件与模型运行。
* 仅「检查更新」会访问网络（GitHub Releases API），可在设置中关闭。

## 从源码构建

环境要求：Node.js 20+、npm 10+、Windows。

```bash
npm install
npm run dev          # Vite 开发服务器 + Electron
npm run build:ui     # 构建渲染层
npm run dist         # 生成安装版与便携版（release/）
npm test             # 核心解析自测
npm run smoke:ui     # 对打包后的应用做无头 CDP 冒烟测试
```

渲染层是 React + Vite；主进程为原生 Electron，启用 `contextIsolation` 并使用最小化的 preload 桥。
解析、媒体装配与诊断位于 `src/core`，不依赖 Electron，可独立复用与测试。

```
src/
  core/            # pcap 读取、SIP/RTP 解析、媒体解码、通话分析、导出
  main/            # Electron 主进程：窗口、托盘、IPC、实时抓包、更新检查
  preload/         # contextBridge API
  renderer/        # React 界面（页面、组件、设计令牌、国际化）
scripts/           # 图标生成、自测、CDP 冒烟测试
```

## 参与贡献

欢迎提交 Issue 与 Pull Request，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。
安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

[MIT](LICENSE) © 2026 M-Ryuga contributors
