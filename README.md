# dsh-reasoning-effort

[English](README.en.md) · [开发说明](DEVELOPMENT.md)

在 DSH 原生模型选择器中调节推理强度，并在模型设置页按模型开启 DeepSeek 请求兼容。

包名：`@light-dawn/dsh-reasoning-effort`，当前开发版本 `0.10.0-dev.2`。目标为 DSH Desktop `0.2.2-rc.1`。尚未发布 npm 包。

## 使用

1. 在 DSH 中保存自定义提供商和模型。
2. 打开 **设置 → 模型**，在对应提供商卡片中找到目标模型。
3. 对确认支持 DeepSeek 思考格式的模型点击 **开启推理强度**。
4. 在聊天模型菜单中选择关闭、低、高或最大。

每个模型单独开启。插件从当前配置读取提供商、模型 ID 和 API 地址，不绑定特定中转站，也不在安装后自动选择模型。

仅适用于 `llm-pi-ai` 的 `openai-completions` 协议，以及支持以下请求方案的模型：

| 档位 | `thinking.type` | `reasoning_effort` |
| --- | --- | --- |
| 关闭 / Off | `disabled` | 省略 |
| 低 / Low | `enabled` | `low` |
| 高 / High | `enabled` | `high` |
| 最大 / Max | `enabled` | `max` |

指令角色使用 `system`，历史思考内容由官方适配器回放。插件不会探测端点能力；请按模型服务的实际支持情况开启。

## 关闭与现有配置

**关闭推理强度**会停止该模型的自动维护，只撤回插件写入且未被用户改动的设置。原有手写配置会保留，因此关闭插件管理后，已有档位仍可能由 DSH 或其他界面显示。

已有自定义档位或兼容设置时，插件展示差异；明确点击修复后才替换。显式 `reasoningEfforts: false` 保持关闭。提供商地址改变后，旧关联不会自动应用到新服务。

模型页按钮与聊天滑块的 Off 含义不同：前者管理模型配置，后者关闭当前请求的思考。“默认”沿用提供商已配置的强度；DSH `0.2.2-rc.1` 未配置默认强度时，官方适配器会关闭思考。

## 安装开发版本

在桌面应用 **插件 → 添加插件** 中输入：

```text
github:light-dawn/dsh-reasoning-effort
```

从上游插件切换时，先停用或卸载 `@ayanehana/dsh-reasoning-effort`，避免同时显示两套控件。按应用提示重新加载。

也可从源码构建：

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm pack --pack-destination dist
```

本地安装可使用生成的 `.tgz` 绝对路径，或解压后包含 `package.json` 的目录绝对路径。Windows 路径应以盘符开头，不带链接渲染产生的前导斜杠。

## 验证范围

类型、国际化、滑块与模型页回归、配置保护与恢复测试通过。实际 DSH `0.2.2-rc.1` 模块在隔离 Profile 中验证了逐模型开启、冷启动与配置更新维护、四档请求、工具历史回放和关闭恢复。HTTP 请求全部拦截，使用虚构凭据和模拟 SSE。

尚未完成完整桌面窗口安装操作、真实线上 API、其他 DSH 版本及 Web Profile 的端到端验证。重复验证方法见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 来源与许可

基于 [HanaAyane/dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort)。保留上游的滑块、动画、模型选择与档位记忆实现，以及 MIT 版权和[许可证](LICENSE)。本 fork 新增用户选择的逐模型请求兼容、冲突处理和恢复。
