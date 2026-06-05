# OMC Hooks Overview

共 28 个钩子，覆盖会话完整生命周期。

---

## SessionStart — 会话启动时

### session-start.mjs
核心启动钩子。恢复持久化模式状态（ralph、ultrawork 等），检测更新，清理过期 session 文件，注入团队 roster（`.omc/roster.json`）到上下文。

### project-memory-session.mjs
自动检测项目环境（语言、框架、构建工具），注入项目记忆上下文（`[PROJECT MEMORY]` 块）。

### wiki-session-start.mjs
加载 wiki 索引，注入 wiki 页面列表（`[LLM Wiki: N pages]` 块）。

### setup-init.mjs
仅 `matcher: "init"` 时触发。处理 `omc init` 流程，引导初始配置。

### setup-maintenance.mjs
仅 `matcher: "maintenance"` 时触发。执行维护任务（清理过期缓存、检查更新等）。

---

## PreToolUse — 工具调用前

### pre-tool-enforcer.mjs
核心预检钩子：
- 注入上下文提醒（"用并行执行""长任务用 run_in_background"等）
- 验证 model 参数合法性（拦截 provider-specific ID、`[1m]` 后缀等）
- 检查 agent heavy preflight（opus 调用前确认）
- 强制 agent 委派策略

### team-agent-guard.mjs
团队模式守卫。当活跃团队存在时，orchestrator 用 `Agent` 工具而非 `SendMessage` 给队友会发出警告，防止单次 spawn 替代持久团队成员。

---

## PermissionRequest — 权限请求时

### permission-handler.mjs
拦截 Bash 权限请求，根据项目 allowlist 自动批准常见命令，减少权限弹窗。

---

## PostToolUse — 工具调用后

### post-tool-verifier.mjs
验证提醒系统：
- 监控工具输出，注入上下文提醒（"先验证再声称完成"等）
- agent 输出分析
- 压缩预警（context 使用 >70%/95% 时提醒）

### project-memory-posttool.mjs
从工具输出中学习，自动提取项目知识写入 project memory。

### post-tool-rules-injector.mjs
访问文件时自动注入相关规则文件（`.claude/rules`、`.github/instructions`、`.cursor/rules` 等）。按 content-hash + realpath 去重，每规则每 session 只注入一次。

### send-message-pane-focus.mjs
tmux 专有。orchestrator → teammate 发消息时，目标 pane 调整为半屏高；teammate 回复时恢复原高度。方便观察活跃 teammate。

---

## PostToolUseFailure — 工具调用失败时

### post-tool-use-failure.mjs
追踪工具失败信息（工具名、输入预览、错误、重试次数），写入 session-scoped 的 `last-tool-error-state.json`，供 Stop hook 的重试引导使用。

---

## SubagentStart / SubagentStop — 子 agent 生命周期

### subagent-tracker.mjs (start)
记录子 agent 启动，追踪活跃子 agent 数量、来源。

### subagent-tracker.mjs (stop)
记录子 agent 结束，清理追踪状态。

### verify-deliverables.mjs
子 agent 结束时检查是否产出了预期交付物（文件存在、内容非空）。从 `.omc/deliverables.json` 或 OMC 默认模板加载要求。**仅告警不阻塞**。

---

## PreCompact — 上下文压缩前

### pre-compact.mjs
压缩前保存关键状态，确保压缩后能恢复上下文。

### project-memory-precompact.mjs
确保用户指令和项目记忆在压缩后存活（注入到压缩摘要中）。

### wiki-pre-compact.mjs
将 wiki 索引注入压缩摘要，确保压缩后仍能看到 wiki 页面列表。

---

## Stop — 会话即将停止时

### context-guard-stop.mjs
上下文守卫。context 使用率超过阈值（默认 75%，`OMC_CONTEXT_GUARD_THRESHOLD` 配置）时，阻止停止并建议刷新 session。最多拦截 2 次防死循环。

### persistent-mode.mjs
持久化模式续命。ralph、ultrawork、ultraqa、team 等模式在 Stop 事件时注入续命指令，让 Claude 继续执行而非真正停止。

### code-simplifier.mjs
可选功能（需 `~/.omc/config.json` 中 `codeSimplifier.enabled: true`）。Stop 时自动将最近修改的源文件委派给 code-simplifier agent 做清理。

### restore-pane-on-stop.mjs
tmux 专有。session 结束时恢复被 `send-message-pane-focus.mjs` 调整过的 pane 高度。

---

## TeammateIdle — 队友空闲时

### restore-pane-on-stop.mjs
同上。teammate 进入空闲时恢复其 pane 高度。

---

## SessionEnd — 会话彻底结束时

### session-end.mjs
会话收尾。清理 session-scoped 状态文件、记录日志、执行 final housekeeping。

### wiki-session-end.mjs
会话结束时保存/更新 wiki 状态。

---

## 生命周期总览

```
SessionStart
  ├─ session-start (状态恢复、roster 注入)
  ├─ project-memory-session (项目环境检测)
  ├─ wiki-session-start (wiki 索引注入)
  ├─ setup-init (仅 init matcher)
  └─ setup-maintenance (仅 maintenance matcher)

PreToolUse
  ├─ pre-tool-enforcer (预检、提醒、model 校验)
  └─ team-agent-guard (团队模式 spawn 警告)

PermissionRequest
  └─ permission-handler (自动批准)

PostToolUse
  ├─ post-tool-verifier (验证提醒、压缩预警)
  ├─ project-memory-posttool (学习)
  ├─ post-tool-rules-injector (规则注入)
  └─ send-message-pane-focus (tmux pane 调整)

PostToolUseFailure
  └─ post-tool-use-failure (失败追踪)

SubagentStart
  └─ subagent-tracker (启动追踪)

SubagentStop
  ├─ subagent-tracker (结束追踪)
  └─ verify-deliverables (交付物检查)

PreCompact
  ├─ pre-compact (状态保存)
  ├─ project-memory-precompact (记忆保护)
  └─ wiki-pre-compact (wiki 保护)

Stop
  ├─ context-guard-stop (上下文守卫)
  ├─ persistent-mode (续命)
  ├─ code-simplifier (可选清理)
  └─ restore-pane-on-stop (tmux 恢复)

TeammateIdle
  └─ restore-pane-on-stop (tmux 恢复)

SessionEnd
  ├─ session-end (收尾清理)
  └─ wiki-session-end (wiki 保存)
```
