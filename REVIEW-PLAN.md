# 代码Review修改计划

## 审查维度：安全、性能、易用性

---

## Phase 1: 安全修复（Critical + High）

### 1.1 XSS修复 - dangerouslySetInnerHTML
- **文件**: `frontend/src/components/Message.tsx:100`
- **问题**: `marked.parse()` 输出未经消毒直接渲染
- **方案**: 安装 DOMPurify，渲染前调用 `DOMPurify.sanitize()`

### 1.2 CORS配置修复
- **文件**: `backend/middleware/cors.ts:5,8`
- **问题**: `Access-Control-Allow-Origin: *` 配合 `Allow-Credentials: true`
- **方案**: 限制为具体的前端 origin（localhost:5173, localhost:3002）

### 1.3 WebSocket认证修复
- **文件**: `backend/websocket/handler.ts:64-66`
- **问题**: 无token文件时所有WS连接免认证
- **方案**: 无token时要求JWT认证，移除旁路

### 1.4 文件上传认证修复
- **文件**: `backend/middleware/userAuth.ts:18-23`
- **问题**: `/uploads` 路径在认证白名单中
- **方案**: 移除 `/uploads` 白名单，通过认证路由提供文件

### 1.5 命令注入修复
- **文件**: `backend/sessions.ts:324,332`
- **问题**: SSH key路径使用字符串插值传入execSync
- **方案**: 使用 execFileSync 数组参数替代字符串插值

### 1.6 目录列表XSS修复
- **文件**: `backend/server.ts:118-133`
- **问题**: 文件名未转义直接嵌入HTML
- **方案**: 添加 HTML 转义函数

### 1.7 速率限制
- **文件**: `backend/routes/auth.ts`
- **问题**: 登录/注册接口无速率限制
- **方案**: 添加 express-rate-limit 中间件

### 1.8 路径遍历修复
- **文件**: `backend/routes/files.ts`, `backend/server.ts`
- **问题**: 符号链接可绕过路径校验
- **方案**: 使用 `fs.realpathSync()` 解析真实路径

### 1.9 CSP头
- **文件**: `backend/server.ts`
- **问题**: 缺少 Content-Security-Policy
- **方案**: 添加基础 CSP 头

---

## Phase 2: 性能修复（Critical + High）

### 2.1 异步化execSync
- **涉及文件**: `backend/sessions.ts`, `backend/agents/*.ts`（66处调用）
- **问题**: 同步子进程调用阻塞事件循环
- **方案**: 将关键路径的 execSync 替换为 exec/spawn Promise

### 2.2 saveToFile 异步化+去抖
- **文件**: `backend/db.ts:513-525`, `backend/sessions.ts:515`
- **问题**: 每10秒同步导出整个DB，每次消息触发写入
- **方案**: 使用 fs.promises.writeFile + debounce 机制

### 2.3 批量session状态API
- **文件**: `frontend/src/App.tsx:360-392`
- **问题**: 每3秒发N+1个请求查询所有session状态
- **方案**: 创建批量状态API + 降低轮询频率到10秒

### 2.4 消息数组内存限制
- **文件**: `backend/sessions.ts:78-79`
- **问题**: 内存中消息数组无上限
- **方案**: 添加硬上限（500条），超出后丢弃旧消息

### 2.5 静态文件缓存
- **文件**: `backend/server.ts:105`
- **问题**: 静态资源无缓存头
- **方案**: 添加 maxAge 和 etag

### 2.6 localStorage写入去抖
- **文件**: `frontend/src/components/ChatPanel.tsx:142-147`
- **问题**: 每次按键都写localStorage
- **方案**: debounce 500ms

### 2.7 Message组件性能优化
- **文件**: `frontend/src/components/Message.tsx:57`
- **问题**: 组件未memoize，每次父组件更新都重渲染
- **方案**: React.memo + useMemo缓存markdown渲染

---

## Phase 3: 易用性修复（Medium + High）

### 3.1 Modal ARIA角色
- **文件**: 多个Modal组件
- **问题**: 缺少 role="dialog", aria-modal, aria-labelledby
- **方案**: 添加标准ARIA属性

### 3.2 图标按钮aria-label
- **文件**: 多个组件
- **问题**: 纯图标按钮缺少aria-label
- **方案**: 为所有图标按钮添加 aria-label

### 3.3 登录表单验证反馈
- **文件**: `frontend/src/components/Login.tsx:21-23`
- **问题**: 空字段提交无视觉反馈
- **方案**: 添加行内验证消息

### 3.4 加载状态改进
- **文件**: `frontend/src/App.tsx:614`
- **问题**: 初始认证检查时空白屏幕
- **方案**: 显示加载spinner

### 3.5 错误恢复
- **文件**: `frontend/src/ErrorBoundary.tsx:25-38`
- **问题**: 崩溃后无恢复机制
- **方案**: 添加"重新加载"按钮

### 3.6 WS断连反馈
- **文件**: `frontend/src/components/ChatPanel.tsx:1236-1240`
- **问题**: WS未连接时发送消息静默失败
- **方案**: 显示"未连接"提示

### 3.7 移除user-scalable=no
- **文件**: `frontend/index.html:5`
- **问题**: 禁止缩放，WCAG违规
- **方案**: 移除限制

### 3.8 错误消息不泄露内部信息
- **文件**: 多个路由文件
- **问题**: 直接返回 error.message
- **方案**: 生产环境返回通用错误信息

---

## Phase 4: 测试验证

### 4.1 后端构建测试
- `cd backend && npm run build` 确保TypeScript编译通过

### 4.2 前端构建测试
- `cd frontend && npm run build` 确保Vite构建通过

### 4.3 类型检查
- `cd backend && npx tsc --noEmit`
- `cd frontend && npx tsc --noEmit`

### 4.4 Lint检查
- `cd backend && npm run lint`
- `cd frontend && npm run lint`

### 4.5 功能测试
- 启动后端和前端，验证基本功能正常

---

## 优先级排序

| 优先级 | Phase | 项目数 | 预估工作量 |
|--------|-------|--------|-----------|
| P0 | Phase 1 安全修复 | 9 | 高 |
| P1 | Phase 2 性能修复 | 7 | 高 |
| P2 | Phase 3 易用性修复 | 8 | 中 |
| P3 | Phase 4 测试验证 | 5 | 中 |
