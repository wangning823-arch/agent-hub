const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = (credentialManager) => {
  // 列出所有凭证（不含密钥）
  router.get('/', (req, res) => {
    res.json(credentialManager.listCredentials());
  });

  // 获取单个host的所有凭证（不含密钥）
  router.get('/:host', (req, res) => {
    const creds = credentialManager.getCredentialsForHost(req.params.host);
    if (creds.length === 0) {
      return res.status(404).json({ error: '未找到该host的凭证' });
    }
    res.json(creds.map(c => {
      const { secret, keyData, ...safe } = c;
      return safe;
    }));
  });

  // 添加/更新凭证
  router.post('/', (req, res) => {
    try {
      const { host, type, username, secret, keyData } = req.body;
      if (!host || !type) {
        return res.status(400).json({ error: 'host和type是必需的' });
      }
      if (!['token', 'ssh'].includes(type)) {
        return res.status(400).json({ error: 'type必须是token或ssh' });
      }
      if (type === 'token' && !secret) {
        return res.status(400).json({ error: 'Token类型需要secret' });
      }
      if (type === 'ssh' && !keyData) {
        return res.status(400).json({ error: 'SSH类型需要keyData' });
      }

      const cred = { type };
      if (username) cred.username = username;
      if (secret) cred.secret = secret;
      if (keyData) cred.keyData = keyData;

      credentialManager.setCredential(host, cred);
      res.json({ success: true, message: `已为 ${username ? username + '@' : ''}${host} 设置凭证` });
    } catch (error) {
      console.error('设置凭证失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 删除凭证（用复合key，如 "git@github.com"）
  router.delete('/:key', (req, res) => {
    credentialManager.removeCredential(req.params.key);
    res.json({ success: true, message: '凭证已删除' });
  });

  // 从现有项目目录扫描Git凭证
  router.post('/scan', (req, res) => {
    try {
      const { workdir } = req.body;
      if (!workdir) {
        return res.status(400).json({ error: 'workdir是必需的' });
      }

      const results = [];

      // 1. 获取 remote URL 和 host
      let remoteUrl = '';
      try {
        remoteUrl = execSync('git config --local --get remote.origin.url', {
          cwd: workdir, encoding: 'utf8'
        }).trim();
      } catch (e) {
        return res.json({ results: [], message: '该项目没有配置Git远程仓库' });
      }

      let host = null;
      let isSsh = false;

      if (remoteUrl.startsWith('https://')) {
        const after = remoteUrl.substring(8);
        const slashIdx = after.indexOf('/');
        if (slashIdx !== -1) host = after.substring(0, slashIdx);
      } else if (remoteUrl.startsWith('git@')) {
        isSsh = true;
        const afterAt = remoteUrl.substring(4);
        const colonIdx = afterAt.indexOf(':');
        if (colonIdx !== -1) host = afterAt.substring(0, colonIdx);
      } else if (remoteUrl.startsWith('ssh://')) {
        isSsh = true;
        const afterProto = remoteUrl.substring(6);
        const atIdx = afterProto.indexOf('@');
        if (atIdx !== -1) {
          const afterAt = afterProto.substring(atIdx + 1);
          const slashIdx = afterAt.indexOf('/');
          if (slashIdx !== -1) host = afterAt.substring(0, slashIdx);
        }
      }

      if (!host) {
        return res.json({ results: [], message: '无法解析远程仓库地址' });
      }

      // 2a. 检查 HTTPS 嵌入token: https://token@host/repo
      if (!isSsh && remoteUrl.includes('@')) {
        const match = remoteUrl.match(/https:\/\/([^@]+)@/);
        if (match) {
          const parts = match[1].split(':');
          results.push({
            host, type: 'token',
            username: parts.length > 1 ? parts[0] : 'oauth2',
            secret: parts.length > 1 ? parts[1] : parts[0],
            source: 'remote URL 嵌入凭证'
          });
        }
      }

      // 2b. 检查 .git/credentials 文件
      const credFile = path.join(workdir, '.git', 'credentials');
      if (fs.existsSync(credFile)) {
        const content = fs.readFileSync(credFile, 'utf8');
        for (const line of content.split('\n')) {
          const match = line.match(/https?:\/\/([^:]+):([^@]+)@/);
          if (match) {
            results.push({
              host, type: 'token',
              username: match[1], secret: match[2],
              source: '.git/credentials 文件'
            });
          }
        }
      }

      // 2c. 检查 credential.helper store 的全局文件
      let helperStore = '';
      try {
        helperStore = execSync('git config --global credential.helper', {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
      } catch (e) {}
      if (helperStore.startsWith('store')) {
        const storeMatch = helperStore.match(/store\s+--file=(.+)/);
        const storePath = storeMatch
          ? storeMatch[1].replace('~', os.homedir())
          : path.join(os.homedir(), '.git-credentials');
        if (fs.existsSync(storePath)) {
          const content = fs.readFileSync(storePath, 'utf8');
          for (const line of content.split('\n')) {
            const match = line.match(/https?:\/\/([^:]*):?([^@]*)@/);
            if (match && line.includes(host)) {
              results.push({
                host, type: 'token',
                username: match[1] || 'oauth2', secret: match[2],
                source: '~/.git-credentials'
              });
            }
          }
        }
      }

      // 2d. SSH 模式：检查 ssh config 和密钥
      if (isSsh) {
        const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
        let identityFile = null;
        let sshUser = 'git';

        if (fs.existsSync(sshConfigPath)) {
          const sshConfig = fs.readFileSync(sshConfigPath, 'utf8');
          const blocks = sshConfig.split(/\nHost\s+/i);
          for (const block of blocks) {
            const lines = block.split('\n');
            const blockHost = lines[0]?.trim().toLowerCase();
            if (blockHost === host || blockHost === '*') {
              for (const line of lines) {
                const m = line.match(/^\s*IdentityFile\s+(.+)/i);
                if (m) {
                  const p = m[1].trim().replace('~', os.homedir());
                  if (fs.existsSync(p)) identityFile = p;
                }
                const um = line.match(/^\s*User\s+(.+)/i);
                if (um) sshUser = um[1].trim();
              }
              if (identityFile) break;
            }
          }
        }

        // 如果 ssh config 没找到，检查默认密钥
        if (!identityFile) {
          for (const key of ['id_rsa', 'id_ed25519', 'id_ecdsa']) {
            const kp = path.join(os.homedir(), '.ssh', key);
            if (fs.existsSync(kp)) { identityFile = kp; break; }
          }
        }

        if (identityFile) {
          const keyData = fs.readFileSync(identityFile, 'utf8');
          // 从 remote URL 提取仓库所有者作为用户名（git@host:owner/repo.git → owner）
          let credUsername = sshUser;
          const ownerMatch = remoteUrl.match(/git@[^:]+:([^/]+)\//);
          if (ownerMatch) credUsername = ownerMatch[1];
          results.push({
            host, type: 'ssh',
            username: credUsername,
            keyData,
            source: `SSH密钥: ${path.basename(identityFile)}`
          });
        }
      }

      res.json({ host, remoteUrl, isSsh, results });
    } catch (error) {
      console.error('扫描凭证失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
