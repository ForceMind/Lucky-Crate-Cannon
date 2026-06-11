const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 全局默认优势
let globalDefaultAdvantage = 0;

// 全局统计数据 (供后台显示)
let globalStats = {
  totalShots: 0,
  totalWins: 0,
  totalCoinsSpent: 0,
  totalCoinsRewarded: 0
};

// 在线玩家状态
const players = new Map();

io.on('connection', (socket) => {
  // 初始化玩家状态
  const player = {
    id: socket.id,
    stats: { shots: 0, wins: 0, spent: 0, rewarded: 0 },
    periodStats: { spent: 0, rewarded: 0 },
    activeAdvantage: null // null 表示继承 globalDefaultAdvantage
  };
  
  players.set(socket.id, player);

  // 每30秒检查并重置当前玩家的 periodStats
  player.timer = setInterval(() => {
    if (player.periodStats.spent > 0) {
      let rtp = player.periodStats.rewarded / player.periodStats.spent;
      if (rtp < 0.80) {
        player.activeAdvantage = -15; // 放水
      } else {
        player.activeAdvantage = null; // 恢复默认
      }
    }
    player.periodStats.spent = 0;
    player.periodStats.rewarded = 0;
  }, 30000);

  // 处理命中逻辑
  socket.on('hit', (data, callback) => {
    const { multi, power } = data;
    if (!multi || !power) {
      if (callback) callback({ error: 'Missing multi or power' });
      return;
    }

    let baseProbability = 1 / multi;
    
    // 确定当前使用的平台优势
    let currentAdvantage = player.activeAdvantage !== null ? player.activeAdvantage : globalDefaultAdvantage;
    
    let finalProbability = baseProbability * (1 - currentAdvantage / 100);
    const win = Math.random() < finalProbability;
    
    // 记录全局和个人数据
    globalStats.totalShots++;
    globalStats.totalCoinsSpent += power;
    player.stats.shots++;
    player.stats.spent += power;
    player.periodStats.spent += power;

    if (win) {
      let reward = power * multi;
      globalStats.totalWins++;
      globalStats.totalCoinsRewarded += reward;
      player.stats.wins++;
      player.stats.rewarded += reward;
      player.periodStats.rewarded += reward;
    }

    // 防大出血：如果当前周期 RTP > 120%，立刻定向打压该玩家
    if (player.periodStats.spent > 0) {
      let currentRtp = player.periodStats.rewarded / player.periodStats.spent;
      if (currentRtp > 1.20) {
        player.activeAdvantage = 20;
      }
    }

    if (callback) callback({ win: win });
  });

  socket.on('disconnect', () => {
    clearInterval(player.timer);
    players.delete(socket.id);
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/admin/advantage', (req, res) => {
  res.json({ advantage: globalDefaultAdvantage });
});

app.post('/api/admin/advantage', (req, res) => {
  const { advantage } = req.body;
  if (typeof advantage === 'number') {
    globalDefaultAdvantage = advantage;
    res.json({ success: true, advantage: globalDefaultAdvantage });
  } else {
    res.status(400).json({ success: false, error: 'Invalid advantage' });
  }
});

app.get('/api/admin/stats', (req, res) => {
  // 组装所有在线玩家的状态
  const onlinePlayers = [];
  for (const [id, player] of players.entries()) {
    let rtp = player.stats.spent > 0 ? (player.stats.rewarded / player.stats.spent * 100).toFixed(1) : 0;
    onlinePlayers.push({
      id: id,
      shots: player.stats.shots,
      spent: player.stats.spent,
      rewarded: player.stats.rewarded,
      rtp: rtp,
      currentAdvantage: player.activeAdvantage !== null ? player.activeAdvantage : globalDefaultAdvantage
    });
  }

  res.json({
    globalStats,
    globalDefaultAdvantage,
    onlinePlayers
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Admin panel on http://localhost:${PORT}/admin`);
});
