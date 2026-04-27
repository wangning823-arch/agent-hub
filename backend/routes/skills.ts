import { Router, Request, Response } from 'express';
const { getSkillsForAgent, installSkill } = require('../skills');

const router = Router();

router.get('/:agentType', async (req: Request, res: Response) => {
  try {
    const { agentType } = req.params;
    const skills = getSkillsForAgent(agentType);
    res.json({ skills, count: skills.length });
  } catch (error: any) {
    console.error('获取 Skills 失败:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/install', async (req: Request, res: Response) => {
  try {
    const { agentType, source, scope } = req.body;

    if (!agentType || !source) {
      return res.status(400).json({ error: '缺少必要参数: agentType, source' });
    }

    const result = await installSkill(agentType, source, { scope });
    const skills = getSkillsForAgent(agentType);

    res.json({
      success: true,
      message: `成功安装: ${source}`,
      skills
    });
  } catch (error: any) {
    console.error('安装 Skill 失败:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
