const WebSocket = require('ws');

const sessionId = process.argv[2] || 'e309dc96-cfa8-4c74-82bf-d1ef6add1dfc';
const message = process.argv[3] || 'Hello, can you list the files in this directory?';

const ws = new WebSocket(`ws://localhost:3001?session=${sessionId}`);

ws.on('open', () => {
  console.log('✅ WebSocket连接成功');
  console.log(`📤 发送消息: ${message}`);
  ws.send(JSON.stringify({ type: 'user_input', content: message }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log(`📥 收到消息 [${msg.type}]:`, msg.content || msg);
});

ws.on('error', (err) => {
  console.error('❌ 错误:', err.message);
});

ws.on('close', () => {
  console.log('🔌 连接关闭');
  process.exit(0);
});

// 10秒后关闭
setTimeout(() => {
  console.log('⏰ 超时关闭');
  ws.close();
}, 15000);
