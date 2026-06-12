const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let globalDefaultAdvantage = 0;
let globalStats = { totalShots: 0, totalWins: 0, totalCoinsSpent: 0, totalCoinsRewarded: 0 };

const boxTypes = [
  {typeIdx:0, multi:2,   chance:.5, w:62, h:48, speed:.85, weight:26},
  {typeIdx:1, multi:3,   chance:.333333, w:64, h:50, speed:.78, weight:20},
  {typeIdx:2, multi:5,   chance:.2, w:66, h:52, speed:.70, weight:16},
  {typeIdx:3, multi:8,   chance:.125,w:70, h:54, speed:.62, weight:11},
  {typeIdx:4, multi:12,  chance:.083333,w:72, h:56, speed:.56, weight:8},
  {typeIdx:5, multi:20,  chance:.05,w:76, h:58, speed:.50, weight:6},
  {typeIdx:6, multi:30,  chance:.033333,w:80, h:60, speed:.43, weight:5},
  {typeIdx:7, multi:50,  chance:.02,w:84, h:62, speed:.36, weight:3},
  {typeIdx:8, multi:100, chance:.01,w:92, h:66, speed:.30, weight:2},
  {typeIdx:9, multi:300, chance:.003333,w:102,h:72, speed:.24, weight:1}
];
function weightedType(){
  const total = boxTypes.reduce((s,b)=>s+b.weight,0);
  let r = Math.random()*total;
  for(const b of boxTypes){ r -= b.weight; if(r <= 0) return b; }
  return boxTypes[0];
}

class Player {
  constructor(socket) {
    this.socket = socket;
    this.id = socket.id;
    this.roomId = null;
    this.role = null; 
    this.visitedRooms = new Set();
    this.stats = { shots: 0, wins: 0, spent: 0, rewarded: 0 };
    this.periodStats = { spent: 0, rewarded: 0 };
    this.activeAdvantage = null; 
    this.activeBullets = new Map();
  }
}

class Room {
  constructor(id) {
    this.id = id;
    this.players = [];
    this.crates = new Map();
    this.seq = 0;
    this.crateIdCounter = 0;
    this.spawnTimer = null;
    this.rtpTimer = null;
    this.createdAt = Date.now();
    this.roomAdvantage = null; 
    this.physicsTimer = null;
  }
  
  start() {
    this.spawnTimer = setInterval(() => this.spawnGroup(), 3000);
    this.rtpTimer = setInterval(() => this.checkRTP(), 30000);
    this.physicsTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, c] of this.crates.entries()) {
        c.x += c.vx * 6; // approximate 100ms
        if (c.x < -800 || c.x > 1800 || (now - c.createdAt > 60000)) {
          this.crates.delete(id);
        }
      }
    }, 100);
  }
  
  stop() {
    clearInterval(this.spawnTimer);
    clearInterval(this.rtpTimer);
    clearInterval(this.physicsTimer);
  }

  broadcast(event, data, excludeSocketId = null) {
    data.seq = ++this.seq;
    data.ts = Date.now();
    for (const p of this.players) {
      if (p.id !== excludeSocketId) {
        p.socket.emit(event, data);
      }
    }
  }

  spawnGroup() {
    if (this.players.length === 0) return;
    const count = Math.floor(3 + Math.random()*6);
    const twoRows = Math.random() < .45;
    const dir = Math.random() < .5 ? 1 : -1;
    const startX = dir > 0 ? -150 : 1150;
    const baseY = 1000 * (0.30 + Math.random()*0.20);
    const gap = 82;
    const groupSpeedScale = .55 + Math.random()*.35;
    
    const newCrates = [];
    for(let i=0;i<count;i++){
      const t = weightedType();
      const row = twoRows ? (i % 2) : 0;
      const y = baseY + row * gap + Math.sin(i*.7)*10;
      const x = startX - dir * i * (t.w + 18);
      const c = {
        id: ++this.crateIdCounter,
        typeIdx: t.typeIdx,
        multi: t.multi,
        w: t.w,
        h: t.h,
        x, y,
        vx: dir * t.speed * groupSpeedScale,
        bobOffset: Math.random()*Math.PI*2,
        expectedHits: t.multi,
        progressHits: 0,
        createdAt: Date.now()
      };
      this.crates.set(c.id, c);
      newCrates.push(c);
    }
    this.broadcast('spawn_crates', { crates: newCrates });
  }

  checkRTP() {
    let totalSpent = 0;
    let totalRewarded = 0;
    for (const p of this.players) {
      totalSpent += p.periodStats.spent;
      totalRewarded += p.periodStats.rewarded;
      p.periodStats.spent = 0;
      p.periodStats.rewarded = 0;
    }
    if (totalSpent > 0) {
      let roomRtp = totalRewarded / totalSpent;
      this.roomAdvantage = (roomRtp < 0.80) ? -15 : null;
    }
  }

  updatePlayerRtpGaps() {
    if (this.players.length === 2) {
      const p1 = this.players[0];
      const p2 = this.players[1];
      let rtp1 = p1.stats.spent > 0 ? (p1.stats.rewarded / p1.stats.spent) : 1.0;
      let rtp2 = p2.stats.spent > 0 ? (p2.stats.rewarded / p2.stats.spent) : 1.0;
      
      if (Math.abs(rtp1 - rtp2) > 0.15 && p1.stats.spent > 10 && p2.stats.spent > 10) {
        if (rtp1 > rtp2) {
          p1.activeAdvantage = 20;
          p2.activeAdvantage = -20;
        } else {
          p1.activeAdvantage = -20;
          p2.activeAdvantage = 20;
        }
      } else {
        p1.activeAdvantage = null;
        p2.activeAdvantage = null;
      }
    }
  }
}

const allPlayers = new Map();
const rooms = new Map();
let roomIdCounter = 0;

function assignRoom(player) {
  let bestRoom = null;
  for (const room of rooms.values()) {
    if (room.players.length === 1 && !player.visitedRooms.has(room.id)) {
      if (!bestRoom || room.createdAt > bestRoom.createdAt) bestRoom = room;
    }
  }

  if (bestRoom) {
    player.roomId = bestRoom.id;
    player.role = 'top'; 
    bestRoom.players.push(player);
    player.visitedRooms.add(bestRoom.id);
    return bestRoom;
  }

  if (player.roomId) {
    const currentRoom = rooms.get(player.roomId);
    if (currentRoom && currentRoom.players.length === 1) return currentRoom;
  }

  const newRoom = new Room(++roomIdCounter);
  rooms.set(newRoom.id, newRoom);
  player.roomId = newRoom.id;
  player.role = 'bottom';
  newRoom.players.push(player);
  player.visitedRooms.add(newRoom.id);
  newRoom.start();
  return newRoom;
}

function joinNewRoom(player, socket) {
  const newRoom = assignRoom(player);
  const cratesArr = Array.from(newRoom.crates.values());
  const peerCount = newRoom.players.length - 1;
  socket.emit('room_joined', {
    roomId: newRoom.id,
    role: player.role,
    roomAdvantage: newRoom.roomAdvantage,
    crates: cratesArr,
    peerCount: peerCount
  });
  newRoom.broadcast('peer_joined', { playerId: player.id }, player.id);
}

io.on('connection', (socket) => {
  const player = new Player(socket);
  allPlayers.set(socket.id, player);
  joinNewRoom(player, socket);

  socket.on('switch_room', (data, callback) => {
    let currentRoom = rooms.get(player.roomId);
    if (currentRoom) {
      currentRoom.players = currentRoom.players.filter(p => p.id !== player.id);
      if (currentRoom.players.length === 0) {
        currentRoom.stop();
        rooms.delete(currentRoom.id);
      } else {
        currentRoom.broadcast('peer_left', { playerId: player.id });
      }
    }
    player.roomId = null;
    joinNewRoom(player, socket);
    if (callback) callback({ success: true });
  });

  socket.on('fire', (data) => {
    player.activeBullets.set(data.bulletId, { power: data.power, ts: Date.now() });

    // 定期清理过期子弹记录
    const now = Date.now();
    for (const [bId, bInfo] of player.activeBullets.entries()) {
      if (now - bInfo.ts > 10000) player.activeBullets.delete(bId);
    }

    const room = rooms.get(player.roomId);
    if (room) {
      room.broadcast('peer_fire', {
        playerId: player.id,
        angle: data.angle,
        power: data.power
      }, player.id);
    }
  });

  socket.on('skill', (data) => {
    const room = rooms.get(player.roomId);
    if (room) room.broadcast('peer_skill', { playerId: player.id, type: data.type }, player.id);
  });

  socket.on('emote', (data) => {
    const room = rooms.get(player.roomId);
    if (room) room.broadcast('peer_emote', { playerId: player.id, emoji: data.emoji }, player.id);
  });

  socket.on('hit', (data, callback) => {
    const { crateId, bulletId, multi, ts } = data;
    const room = rooms.get(player.roomId);
    if (!room) return callback && callback({ success: false });
    
    const bullet = player.activeBullets.get(bulletId);
    if (!bullet) return callback && callback({ success: false, win: false, alive: false, error: 'Invalid bullet' });
    
    player.activeBullets.delete(bulletId);
    const power = bullet.power;

    const crate = room.crates.get(crateId);
    if (!crate) return callback && callback({ success: false, win: false, alive: false });

    let baseProbability = 1 / multi;
    let currentAdvantage = globalDefaultAdvantage;
    if (room.roomAdvantage !== null) currentAdvantage = room.roomAdvantage;
    if (player.activeAdvantage !== null) currentAdvantage = player.activeAdvantage;
    
    let finalProbability = baseProbability * (1 - currentAdvantage / 100);
    const win = Math.random() < finalProbability;
    
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
      room.crates.delete(crateId);
    } else {
      crate.progressHits++;
    }

    room.updatePlayerRtpGaps();

    room.broadcast('hit_result', {
      crateId,
      playerId: player.id,
      win, power, multi,
      progressHits: crate.progressHits
    });

    if (callback) callback({ success: true, win, alive: !win, progressHits: crate.progressHits });
  });

  socket.on('disconnect', () => {
    let currentRoom = rooms.get(player.roomId);
    if (currentRoom) {
      currentRoom.players = currentRoom.players.filter(p => p.id !== player.id);
      if (currentRoom.players.length === 0) {
        currentRoom.stop();
        rooms.delete(currentRoom.id);
      } else {
        currentRoom.broadcast('peer_left', { playerId: player.id });
      }
    }
    allPlayers.delete(socket.id);
  });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/api/admin/advantage', (req, res) => res.json({ advantage: globalDefaultAdvantage }));
app.post('/api/admin/advantage', (req, res) => {
  const { advantage } = req.body;
  if (typeof advantage === 'number') {
    globalDefaultAdvantage = advantage;
    res.json({ success: true, advantage: globalDefaultAdvantage });
  } else res.status(400).json({ success: false, error: 'Invalid advantage' });
});

app.post('/api/admin/kick', (req, res) => {
  const { id } = req.body;
  const p = allPlayers.get(id);
  if (p) {
    p.socket.disconnect(true);
    res.json({ success: true });
  } else res.json({ success: false });
});

app.post('/api/admin/close_room', (req, res) => {
  const { id } = req.body;
  const room = rooms.get(Number(id));
  if (room) {
    for (const p of room.players) { p.socket.disconnect(true); }
    room.stop();
    rooms.delete(room.id);
    res.json({ success: true });
  } else res.json({ success: false });
});

app.get('/api/admin/stats', (req, res) => {
  const onlinePlayers = [];
  for (const [id, player] of allPlayers.entries()) {
    let rtp = player.stats.spent > 0 ? (player.stats.rewarded / player.stats.spent * 100).toFixed(1) : 0;
    let adv = globalDefaultAdvantage;
    if (player.roomId) {
      const room = rooms.get(player.roomId);
      if (room && room.roomAdvantage !== null) adv = room.roomAdvantage;
    }
    if (player.activeAdvantage !== null) adv = player.activeAdvantage;

    onlinePlayers.push({
      id: id,
      roomId: player.roomId,
      shots: player.stats.shots,
      spent: player.stats.spent,
      rewarded: player.stats.rewarded,
      rtp: rtp,
      currentAdvantage: adv
    });
  }

  const activeRooms = [];
  for (const [id, room] of rooms.entries()) {
    activeRooms.push({ id, players: room.players.length, adv: room.roomAdvantage });
  }

  res.json({ globalStats, globalDefaultAdvantage, onlinePlayers, activeRooms });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
