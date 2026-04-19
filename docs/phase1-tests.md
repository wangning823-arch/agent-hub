# Phase1 API Test Draft

- 目的：对 Phase1 路由进行快速覆盖，确保新增接口在不破坏现有行为的前提下可用并具备基本正确性。
- 测试粒度：端到端的集成测试优先（通过实际 http 调用），辅助单元测试用例草案。

## 环境准备
- 本地服务：后端 Node.js；已启动 Agent Hub 服务。
- 端口：HTTP 3001（如配置不同，请调整 URL）

## 测试用例（按接口分组）

1. Phase1 就绪性
- 目标：确认 Phase1 路由已加载，返回就绪信息。
- 请求：GET /api/phase1/status
- 断言：响应状态码 200，body 结构包含 { ready: true, count: number }。

2. Phase1 会话基本 CRUD
- 2.1 创建 Phase1 会话
- 请求：POST /api/phase1/sessions
- 体：{ "workdir": "/tmp/phase1", "agentType": "claude-code" }
- 断言：返回 200，包含 session 对象，并带有 id、workdir、agentType 字段。

- 2.2 列出 Phase1 会话
- 请求：GET /api/phase1/sessions
- 断言：返回数组，长度≥0，元素包含 id、workdir、agentType。

- 2.3 获取指定 Phase1 会话
- 请求：GET /api/phase1/sessions/{id}
- 断言：返回会话对象，包含 id 字段与会话元数据。

- 2.4 重命名 Phase1 会话
- 请求：PUT /api/phase1/sessions/{id}/rename
- 体：{ "title": "New Phase1 Title" }
- 断言：返回 session 对象，title 字段更新为传入值，updatedAt 更新。

- 2.5 更新 Phase1 会话字段（批量）
- 请求：PUT /api/phase1/sessions/{id}
- 体：{ "title": "Updated", "conversationId": "abc-123" }
- 断言：返回 session，相关字段已更新，updatedAt 改变。

- 2.6 置顶/取消置顶
- 请求：POST /api/phase1/sessions/{id}/pin
- 请求：POST /api/phase1/sessions/{id}/unpin
- 断言：字段 isPinned 在会话对象中正确反映状态。

- 2.7 归档/取消归档
- 请求：POST /api/phase1/sessions/{id}/archive
- 断言：isArchived 字段更新。

- 2.8 删除阶段1会话
- 请求：DELETE /api/phase1/sessions/{id}
- 断言：返回 { success: true, id }，会话在列表中不再出现（后续查询可验证）。

3. Phase1 标签管理
- 3.1 获取标签
- 请求：GET /api/phase1/sessions/{id}/tags
- 断言：返回 { tags: [...] }，若不存在则空数组。

- 3.2 设置标签（批量）
- 请求：PUT /api/phase1/sessions/{id}/tags
- 体：{ "tags": ["urgent", "frontend"] }
- 断言：返回 updated session 对象或含有 tags 字段。

- 3.3 增加标签
- 请求：POST /api/phase1/sessions/{id}/tags
- 体：{ "tag": "urgent" }
- 断言：标签被加入到会话的标签集合中。

- 3.4 删除标签
- 请求：DELETE /api/phase1/sessions/{id}/tags/{tag}
- 断言：标签从会话中移除。

- 3.5 按标签筛选
- 请求：GET /api/phase1/sessions/tag/{tag}
- 断言：返回符合条件的会话列表。

4. Phase1 删除最后若干消息
- 4.1 删除最后 N 条消息
- 请求：POST /api/phase1/sessions/{id}/delete-last
- 体：{ "count": 2 }
- 断言：返回含有删除数量的结果对象，实际消息数减少。

> 备注
- 上述为初步草案，实际自动化测试可在后续阶段逐步实现。初期建议先实现就绪性与核心 CRUD，确保路径和数据流正确，再逐步覆盖边界与异常场景。 
