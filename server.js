const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 平台概率优势百分比 (Platform Advantage Percentage)
// 0 表示没有优势 (正常爆率)
// 3 表示平台有 3% 的优势，玩家实际胜率 = 原胜率 * (1 - 3/100)
// -2 表示平台让利 2%，玩家实际胜率 = 原胜率 * (1 + 2/100)
let platformAdvantage = 0;

// 数据统计 (实时在内存中累积，用于展示)
let stats = {
  totalShots: 0,
  totalWins: 0,
  totalCoinsSpent: 0,
  totalCoinsRewarded: 0
};

// 周期统计 (用于动态调整爆率，每30秒重置)
let periodStats = {
  spent: 0,
  rewarded: 0
};

// 每30秒执行一次检查与重置
setInterval(() => {
  if (periodStats.spent > 0) {
    let rtp = periodStats.rewarded / periodStats.spent;
    // 如果 RTP 低于 80%，平台优势改为 -15
    if (rtp < 0.80) {
      platformAdvantage = -15;
    }
  }
  // 重置统计
  periodStats.spent = 0;
  periodStats.rewarded = 0;
}, 30000);

// 提供主游戏页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 提供后台管理页面
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// 游戏逻辑：判断是否击破
app.post('/api/hit', (req, res) => {
  const { multi, power } = req.body;
  
  if (!multi || !power) {
    return res.status(400).json({ error: 'Missing multi or power' });
  }

  // 基础获胜概率
  let baseProbability = 1 / multi;
  
  // 结合平台优势的最终概率
  let finalProbability = baseProbability * (1 - platformAdvantage / 100);

  // 生成随机数判断是否获胜
  const win = Math.random() < finalProbability;
  
  // 统计数据
  stats.totalShots++;
  stats.totalCoinsSpent += power;
  periodStats.spent += power;
  
  if (win) {
    let reward = power * multi;
    stats.totalWins++;
    stats.totalCoinsRewarded += reward;
    periodStats.rewarded += reward;
  }

  // 无论什么时候如果用户 RTP 当下高于 120%，则平台优势改为 20
  if (periodStats.spent > 0) {
    let currentRtp = periodStats.rewarded / periodStats.spent;
    if (currentRtp > 1.20) {
      platformAdvantage = 20;
    }
  }

  res.json({
    win: win,
    // 实际生产环境中不要把概率传回前端，这里为了调试和演示可以传回
    _debug_prob: finalProbability 
  });
});

// 后台 API：获取当前平台优势
app.get('/api/admin/advantage', (req, res) => {
  res.json({ advantage: platformAdvantage });
});

// 后台 API：设置平台优势
app.post('/api/admin/advantage', (req, res) => {
  const { advantage } = req.body;
  if (typeof advantage === 'number') {
    platformAdvantage = advantage;
    res.json({ success: true, advantage: platformAdvantage });
  } else {
    res.status(400).json({ success: false, error: 'Invalid advantage value' });
  }
});

// 后台 API：获取实时数据统计
app.get('/api/admin/stats', (req, res) => {
  res.json(stats);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Admin panel on http://localhost:${PORT}/admin`);
});
