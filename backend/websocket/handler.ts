import fs from 'fs';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import SessionManager from '../sessions';
import { getDb, getJwtSecret } from '../db';
import { UserContext } from '../types';

export default (sessionManager: SessionManager, TOKEN_FILE: string) => {
  let ACCESS_TOKEN = '';
  try {
    ACCESS_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch (_e) {}

  function authenticateWs(req: IncomingMessage): { user?: UserContext; error?: string } {
    let url: URL;
    try {
      url = new URL(req.url || '', `http://${req.headers.host}`);
    } catch (e) {
      url = new URL(req.url || '', 'http://localhost');
    }

    // 1. Try JWT from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const decoded = jwt.verify(token, getJwtSecret()) as { userId: string; username: string; role: string };
        const db = getDb();
        const result = db.exec(
          `SELECT id, username, role, home_dir FROM users WHERE id = '${decoded.userId.replace(/'/g, "''")}' AND is_active = 1`
        );
        if (result.length > 0 && result[0].values.length > 0) {
          const row = result[0].values[0];
          return {
            user: {
              userId: row[0] as string,
              username: row[1] as string,
              role: row[2] as 'admin' | 'user',
              homeDir: row[3] as string,
            }
          };
        }
        return { error: '用户不存在或已停用' };
      } catch (e) {
        return { error: 'Token 已过期或无效' };
      }
    }

    // 2. Try legacy token
    const token = url.searchParams.get('token');
    if (ACCESS_TOKEN && token === ACCESS_TOKEN) {
      const ALLOWED_ROOT = process.env.ALLOWED_ROOT || process.env.HOME || '/root';
      return {
        user: {
          userId: '__legacy__',
          username: '__legacy__',
          role: 'admin',
          homeDir: ALLOWED_ROOT,
        }
      };
    }

    // 3. No token required if no ACCESS_TOKEN set
    if (!ACCESS_TOKEN) {
      return {};
    }

    return { error: '未授权' };
  }

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
      const auth = authenticateWs(req);
      if (auth.error) {
        ws.close(4001, auth.error);
        return;
      }

      let url: URL;
      try {
        url = new URL(req.url || '', `http://${req.headers.host}`);
      } catch (e) {
        url = new URL(req.url || '', 'http://localhost');
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

      // Validate session ownership for non-admin users
      if (auth.user && auth.user.role !== 'admin' && session.userId && session.userId !== auth.user.userId) {
        ws.close(4003, '无权访问此会话');
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
             let content = msg.content;
             let quote = msg.quote || null;
             if (quote && quote.content) {
               const roleLabel = quote.role === 'user' ? '用户' : '助手';
               content = `[引用${roleLabel}消息]: ${quote.content}\n\n${msg.content}`;
             }
             await sessionManager.sendMessage(sessionId, content, quote);
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
