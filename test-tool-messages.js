const WebSocket = require('ws');

const sessionId = process.argv[2] || '2f479aa2-d118-4b89-97da-e88206dca851';
const message = process.argv[3] || '请列出当前目录的文件';

const ws = new WebSocket(`ws://localhost:3001?session=${sessionId}`);

ws.on('open', () => {
  console.log('✅ WebSocket连接成功');
  console.log(`📤 发送消息: ${message}`);
  ws.send(JSON.stringify({ type: 'user_input', content: message }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log(`📥 收到消息 [${msg.type}]:`, msg.content || msg);
  
  // 如果是工具调用消息，检查是否被合并
  if (msg.type === 'tool_use') {
    console.log('🔧 工具调用:', msg.metadata?.tool || '未知工具');
  }
});

ws.on('error', (err) => {
  console.error('❌ 错误:', err.message);
});

ws.on('close', () => {
  console.log('🔌 连接关闭');
  process.exit(0);
});

// 保持连接30秒
setTimeout(() => {
  console.log('⏰ 30秒后自动关闭');
  ws.close();
}, 30000);