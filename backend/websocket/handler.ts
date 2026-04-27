import fs from 'fs';
import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import SessionManager from '../sessions';

export default (sessionManager: SessionManager, TOKEN_FILE: string) => {
  let ACCESS_TOKEN = '';
  try {
    ACCESS_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch (_e) {}

  async function handleCommand(sessionId: string, command: string, params: Record<string, any> = {}) { // TODO: type this
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    const agent = session.agent as any;

    switch (command) {
      case 'set_mode':
        if (agent?.updateOptions) {
          agent.updateOptions({ mode: params.mode });
        }
        session.options = { ...session.options, mode: params.mode };
        sessionManager.saveSession(session);
        break;

      case 'set_model':
        if (agent?.updateOptions) {
          agent.updateOptions({ model: params.model });
        }
        session.options = { ...session.options, model: params.model };
        sessionManager.saveSession(session);
        break;

      case 'set_effort':
        if (agent?.updateOptions) {
          agent.updateOptions({ effort: params.effort });
        }
        session.options = { ...session.options, effort: params.effort };
        sessionManager.saveSession(session);
        break;

      case 'update_options':
        if (agent?.updateOptions) {
          agent.updateOptions(params);
        }
        session.options = { ...session.options, ...params };
        sessionManager.saveSession(session);
        break;

      default:
        throw new Error(`未知命令: ${command}`);
    }
  }

  return (wss: any) => { // TODO: type this
    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      let url: URL;
      try {
        url = new URL(req.url || '', `http://${req.headers.host}`);
      } catch (e) {
        url = new URL(req.url || '', 'http://localhost');
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
         } catch (error: any) { // TODO: type this
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
