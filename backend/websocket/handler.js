const fs = require('fs');
const path = require('path');

module.exports = (sessionManager, TOKEN_FILE) => {
  let ACCESS_TOKEN = '';
  try {
    ACCESS_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch (e) {}

  async function handleCommand(sessionId, command, params = {}) {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    const agent = session.agent;

    switch (command) {
      case 'set_mode':
        if (agent.updateOptions) {
          agent.updateOptions({ mode: params.mode });
        }
        // 同步更新session.options并保存
        session.options = { ...session.options, mode: params.mode };
        sessionManager.saveSession(session);
        break;

      case 'set_model':
        if (agent.updateOptions) {
          agent.updateOptions({ model: params.model });
        }
        // 同步更新session.options并保存
        session.options = { ...session.options, model: params.model };
        sessionManager.saveSession(session);
        break;

      case 'set_effort':
        if (agent.updateOptions) {
          agent.updateOptions({ effort: params.effort });
        }
        // 同步更新session.options并保存
        session.options = { ...session.options, effort: params.effort };
        sessionManager.saveSession(session);
        break;

      case 'update_options':
        if (agent.updateOptions) {
          agent.updateOptions(params);
        }
        // 同步更新session.options并保存
        session.options = { ...session.options, ...params };
        sessionManager.saveSession(session);
        break;

      default:
        throw new Error(`未知命令: ${command}`);
    }
  }

  return (wss) => {
    wss.on('connection', (ws, req) => {
      let url;
      try {
        url = new URL(req.url, `http://${req.headers.host}`);
      } catch (e) {
        url = new URL(req.url, 'http://localhost');
      }

      if (ACCESS_TOKEN) {
        const token = url.searchParams.get('token');
        if (token !== ACCESS_TOKEN) {
          ws.close(4001, 'unauthorized');
          return;
        }
      }

      const sessionId = url.searchParams.get('session');

      if (!sessionId) {
        ws.close(4000, '需要sessionId参数');
        return;
      }

      const session = sessionManager.getSession(sessionId);
      if (!session) {
        ws.close(4001, '会话不存在');
        return;
      }

      console.log(`WebSocket连接: session=${sessionId}`);
      sessionManager.addClient(sessionId, ws);

       ws.on('message', async (data) => {
         try {
           const msg = JSON.parse(data.toString());

           if (msg.type === 'ping') {
             // 心跳响应
             ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
             return;
           } else if (msg.type === 'user_input') {
             await sessionManager.sendMessage(sessionId, msg.content);
           } else if (msg.type === 'command') {
             await handleCommand(sessionId, msg.command, msg.params);
           }
         } catch (error) {
           ws.send(JSON.stringify({ type: 'error', content: error.message }));
         }
       });

      ws.on('close', () => {
        console.log(`WebSocket断开: session=${sessionId}`);
        sessionManager.removeClient(sessionId, ws);
      });
    });
  };
};