const express = require('express');
const router = express.Router();
const { getSkillsForAgent, installSkill } = require('../skills');

router.get('/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const skills = getSkillsForAgent(agentType);
    res.json({ skills, count: skills.length });
  } catch (error) {
    console.error('获取 Skills 失败:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/install', async (req, res) => {
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
  } catch (error) {
    console.error('安装 Skill 失败:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;