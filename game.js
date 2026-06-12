const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const socket = io();

const LOGICAL_W = 1000;
const LOGICAL_H = 1000;

let currentLang = 'en';
const i18n = {
  en: {
    boxes: ["Wood", "Green", "Blue", "Purple", "Red", "Silver", "Gold", "Gem", "Crown", "Legend"],
    cost: "Cost: ",
    coins: " Coins",
    shots: "Shots",
    wins: "Wins",
    auto: "Auto",
    manual: "Manual",
    on: "ON",
    off: "OFF",
    lock: "Lock",
    freeze: "Freeze",
    ready: "Ready",
    almostBreak: "Crack",
    hit: "Hit",
    paused: "PAUSED",
    switchRoom: "Switch",
    room: "Room ",
    hint: "Auto/Lock/Freeze · - / + to adjust cannon",
    langToggle: "中" 
  },
  zh: {
    boxes: ["木箱", "绿箱", "蓝箱", "紫箱", "红箱", "银箱", "金箱", "宝石箱", "王冠箱", "传奇箱"],
    cost: "发射消耗：",
    coins: " 金币",
    shots: "发射",
    wins: "击破",
    auto: "自动",
    manual: "手动",
    on: "开",
    off: "关",
    lock: "锁定",
    freeze: "冷冻",
    ready: "可用",
    almostBreak: "快碎了",
    hit: "命中",
    paused: "暂停",
    switchRoom: "换房",
    room: "房间 ",
    hint: "自动开火/锁定/冷冻技能 · 炮台旁 - / + 调整炮倍",
    langToggle: "EN"
  }
};
function t(key, idx = -1) {
  if (idx !== -1) return i18n[currentLang][key][idx];
  return i18n[currentLang][key];
}

let W = 0, H = 0, DPR = 1;
function resize(){
  DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  W = Math.floor(window.innerWidth);
  H = Math.floor(window.innerHeight);
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener("resize", resize);
resize();

let myRole = 'bottom';
let roomId = null;
let roomAdvantage = null;

function toScreen(lx, ly) {
  if (myRole === 'top') {
    lx = LOGICAL_W - lx;
    ly = LOGICAL_H - ly;
  }
  return { x: lx * (W / LOGICAL_W), y: ly * (H / LOGICAL_H) };
}

function toLogical(sx, sy) {
  let lx = sx * (LOGICAL_W / W);
  let ly = sy * (LOGICAL_H / H);
  if (myRole === 'top') {
    lx = LOGICAL_W - lx;
    ly = LOGICAL_H - ly;
  }
  return { x: lx, y: ly };
}

function getUiLayout() {
  const isMobile = W < 600;
  const radius = isMobile ? 22 : 30;
  const spacing = isMobile ? 52 : 75;
  const startX = isMobile ? 10 + radius : W - spacing * 3 + 10;
  const skillY = H - (isMobile ? 35 : 45);
  const cannonBtnW = isMobile ? 34 : 42;
  const cannonBtnH = isMobile ? 28 : 34;
  const cannonBtnOffset = isMobile ? 55 : 71;
  const cx = W/2, cy = H - 62;
  
  return { isMobile, radius, spacing, startX, skillY, cannonBtnW, cannonBtnH, cannonBtnOffset, cx, cy };
}

let coins = 1000;
let cannonLevel = 1;
const levels = [1,2,5,10];
let bullets = [], crates = [], particles = [], floatTexts = [], coinsFly = [];
let peerBullets = [];
let myBulletCounter = 0;
let target = {x: W/2, y: H/2};
let firing = false;
let autoFire = false;
let lockMode = false;
let lockedCrate = null;
let freezeCd = 0;
let freezeTimer = 0;
let fireCd = 0;
let paused = false;
let shake = 0;
let totalShots = 0, totalWins = 0;

let peerAngle = Math.PI/2;
let peerLevel = 1;
let hasPeer = false;

let myEmote = null;
let myEmoteTimer = 0;
let peerEmote = null;
let peerEmoteTimer = 0;
const EMOJIS = ['👍', '😎', '😅', '😡'];

socket.on('room_joined', data => {
  roomId = data.roomId;
  myRole = data.role;
  roomAdvantage = data.roomAdvantage;
  crates = data.crates; 
  hasPeer = data.peerCount > 0;
  bullets = [];
  peerBullets = [];
});

socket.on('peer_joined', () => { hasPeer = true; });
socket.on('peer_left', () => { hasPeer = false; });

socket.on('spawn_crates', data => {
  for (const c of data.crates) {
    crates.push(c);
  }
});

socket.on('peer_fire', data => {
  peerAngle = data.angle;
  peerLevel = data.power;
  
  const oppCannonLogical = toLogical(W/2, 62);
  const speed = getBulletSpeed(data.power) * (LOGICAL_W / 500); 
  
  peerBullets.push({
    lx: oppCannonLogical.x + Math.cos(data.angle)*30, 
    ly: oppCannonLogical.y + Math.sin(data.angle)*30,
    lvx: Math.cos(data.angle) * speed,
    lvy: Math.sin(data.angle) * speed,
    power: data.power,
    life: 1
  });
});

socket.on('peer_skill', data => {
  if (data.type === 'freeze') {
    freezeTimer = 300;
  }
});

socket.on('peer_emote', data => {
  peerEmote = data.emoji;
  peerEmoteTimer = 120;
});

socket.on('hit_result', data => {
  const { crateId, playerId, win, power, multi, progressHits } = data;
  const c = crates.find(cr => cr.id === crateId);
  if (!c) return;

  if (win) {
    c.alive = false;
    if (lockedCrate === c) lockedCrate = null;
    const {x:sx, y:sy} = toScreen(c.x, c.y);
    
    if (playerId === socket.id) {
      const reward = power * multi;
      coins += reward;
      totalWins++;
      floatTexts.push({x:sx, y:sy-35, txt:"+"+reward, life:70, size:24, rise:1.1});
      shake = 8;
      for(let i=0;i<8;i++){
        coinsFly.push({x:sx+(Math.random()-.5)*40, y:sy+(Math.random()-.5)*30, tx:39, ty:H-69, life:45+i*2});
      }
    } else {
      floatTexts.push({x:sx, y:sy-35, txt:"队友击杀", life:40, size:18, rise:1});
    }

    for(let i=0;i<18;i++){
      particles.push({x:sx, y:sy, vx:(Math.random()-.5)*9, vy:(Math.random()-.5)*9, life:35, size:3+Math.random()*5});
    }
  } else {
    c.progressHits = progressHits;
    c.hitFlash = 10;
    c.slow = 28;
    c.crack = Math.min(1, c.progressHits / c.expectedHits);
  }
});

function getBulletSpeed(level) {
  return 10 + Math.log2(level) * 4; 
}

function fire(){
  if(coins < cannonLevel) return;
  coins -= cannonLevel;
  totalShots++;
  
  const { cx, cy } = getUiLayout();
  let aimX = target.x, aimY = target.y;
  if(lockMode && lockedCrate && lockedCrate.alive){
    const sCrate = toScreen(lockedCrate.x, lockedCrate.y);
    aimX = sCrate.x;
    aimY = sCrate.y;
  }
  
  const lOrigin = toLogical(cx, cy);
  const lTarget = toLogical(aimX, aimY);
  let ldx = lTarget.x - lOrigin.x;
  let ldy = lTarget.y - lOrigin.y;
  const lAngle = Math.atan2(ldy, ldx);

  const bId = ++myBulletCounter;
  socket.emit('fire', { angle: lAngle, power: cannonLevel, bulletId: bId });
  
  const speed = getBulletSpeed(cannonLevel) * (LOGICAL_W / 500);
  bullets.push({
    id: bId,
    lx: lOrigin.x + Math.cos(lAngle)*30, ly: lOrigin.y + Math.sin(lAngle)*30,
    lvx: Math.cos(lAngle) * speed, lvy: Math.sin(lAngle) * speed,
    r: 4 + Math.log2(cannonLevel+1)*1.5,
    power: cannonLevel,
    life: 1,
    lockedTarget: (lockMode && lockedCrate && lockedCrate.alive) ? lockedCrate : null
  });
  
  fireCd = Math.max(4, 12 - cannonLevel * .45);
}

function crateAt(x,y){
  for(let i=crates.length-1;i>=0;i--){
    const c = crates[i];
    if(c.alive === false) continue;
    const {x: csx, y: csy} = toScreen(c.x, c.y);
    if(x > csx-c.w/2 && x < csx+c.w/2 && y > csy-c.h/2 && y < csy+c.h/2) return c;
  }
  return null;
}

function update(){
  if(paused) return;
  if(shake > 0) shake *= .82;

  if(firing || autoFire){
    if(fireCd <= 0) fire();
  }
  if(fireCd > 0) fireCd--;
  if(freezeCd > 0) freezeCd--;
  if(freezeTimer > 0) freezeTimer--;

  for(const c of crates){
    const slowMul = freezeTimer > 0 ? 0 : (c.slow > 0 ? .28 : 1);
    c.x += c.vx * slowMul;
    c.bobOffset += freezeTimer > 0 ? 0 : .035;
    if(c.hitFlash > 0) c.hitFlash--;
    if(c.slow > 0) c.slow--;
  }
  crates = crates.filter(c => c.alive !== false && c.x > -400 && c.x < 1400);
  
  if(lockedCrate && (!lockedCrate.alive || !crates.includes(lockedCrate))) {
    lockedCrate = null;
  }
  
  if (lockMode && !lockedCrate && crates.length > 0) {
    let highestMulti = 0;
    let bestCrate = null;
    for (const c of crates) {
      if (c.multi > highestMulti) {
        highestMulti = c.multi;
        bestCrate = c;
      }
    }
    lockedCrate = bestCrate;
  }

  // Update my bullets
  for(const b of bullets){
    if(b.lockedTarget && b.lockedTarget.alive){
      const c = b.lockedTarget;
      const dx = c.x - b.lx, dy = c.y - b.ly;
      const d = Math.max(1, Math.hypot(dx,dy));
      const speed = getBulletSpeed(b.power) * (LOGICAL_W/500);
      b.lvx = dx / d * speed;
      b.lvy = dy / d * speed;
    }
    b.lx += b.lvx; b.ly += b.lvy;
    
    if(b.lx < 0){ b.lx = 0; b.lvx *= -1; }
    if(b.lx > LOGICAL_W){ b.lx = LOGICAL_W; b.lvx *= -1; }
    if(b.ly < 0){ b.ly = 0; b.lvy *= -1; }
    if(b.ly > LOGICAL_H){ b.ly = LOGICAL_H; b.lvy *= -1; }
    
    const {x: bsx, y: bsy} = toScreen(b.lx, b.ly);
    
    for(const c of crates){
      if(c.alive === false) continue;
      const {x: csx, y: csy} = toScreen(c.x, c.y);
      if(bsx > csx-c.w/2 && bsx < csx+c.w/2 && bsy > csy-c.h/2 && bsy < csy+c.h/2){
        b.life = 0;
        c.hitFlash = 10;
        for(let i=0;i<6;i++) particles.push({x:bsx, y:bsy, vx:(Math.random()-.5)*5, vy:(Math.random()-.5)*5, life:22, size:2+Math.random()*3});
        socket.emit('hit', { crateId: c.id, bulletId: b.id, multi: c.multi, ts: Date.now() });
        break;
      }
    }
  }
  bullets = bullets.filter(b => b.life > 0);

  // Update peer bullets
  for(const b of peerBullets){
    b.lx += b.lvx; b.ly += b.lvy;
    const {x: bsx, y: bsy} = toScreen(b.lx, b.ly);
    for(const c of crates){
      if(c.alive === false) continue;
      const {x: csx, y: csy} = toScreen(c.x, c.y);
      if(bsx > csx-c.w/2 && bsx < csx+c.w/2 && bsy > csy-c.h/2 && bsy < csy+c.h/2){
        b.life = 0;
        for(let i=0;i<6;i++) particles.push({x:bsx, y:bsy, vx:(Math.random()-.5)*5, vy:(Math.random()-.5)*5, life:22, size:2+Math.random()*3});
        break;
      }
    }
  }
  peerBullets = peerBullets.filter(b => b.life > 0 && b.lx>0 && b.lx<LOGICAL_W && b.ly>0 && b.ly<LOGICAL_H);

  for(const p of particles){ p.x += p.vx; p.y += p.vy; p.vy += .08; p.life--; }
  particles = particles.filter(p=>p.life>0);

  for(const f of floatTexts){ f.y -= f.rise; f.life--; }
  floatTexts = floatTexts.filter(f=>f.life>0);

  for(const cf of coinsFly){
    const tv = .13;
    cf.x += (cf.tx - cf.x)*tv;
    cf.y += (cf.ty - cf.y)*tv;
    cf.life--;
  }
  coinsFly = coinsFly.filter(c=>c.life>0);
}

function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

const colors = ["#B97843", "#3CC47C", "#3E8BFF", "#9B5CFF", "#FF5656", "#C9D2DE", "#FFC83D", "#35E9E1", "#FF9D26", "#F567FF"];
const edges = ["#7b4a25", "#197646", "#1f4f9e", "#5c2bb2", "#a92222", "#6d7a8a", "#b57b00", "#008d8a", "#b04d00", "#8120a0"];

function drawCrate(c){
  const {x: sx, y: sy} = toScreen(c.x, c.y);
  const sw = c.w;
  const sh = c.h;
  
  const yOffset = Math.sin(c.bobOffset)*5;
  ctx.save();
  ctx.translate(sx, sy + yOffset);
  if(c.hitFlash>0) ctx.scale(1.06,1.06);

  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  roundRect(-sw/2,-sh/2,sw,sh,10);
  ctx.fillStyle = c.hitFlash>0 ? "#fff4bf" : colors[c.typeIdx];
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = edges[c.typeIdx];
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.globalAlpha = .78;
  ctx.fillStyle = edges[c.typeIdx];
  ctx.fillRect(-sw/2+8, -5, sw-16, 10);
  ctx.fillRect(-6, -sh/2+6, 12, sh-12);

  if(c.crack && c.crack > .12){
    ctx.globalAlpha = Math.min(.95, c.crack + .15);
    ctx.strokeStyle = "rgba(35,25,20,.95)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-8, -sh*.32);
    ctx.lineTo(0, -sh*.12);
    ctx.lineTo(-5, sh*.02);
    ctx.lineTo(8, sh*.20);
    if(c.crack>.45){ ctx.moveTo(0,-sh*.12); ctx.lineTo(16,-sh*.25); }
    if(c.crack>.7){ ctx.moveTo(-5,sh*.02); ctx.lineTo(-20,sh*.18); }
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0,0,0,.52)";
  roundRect(-28, -sh/2-30, 56, 21, 10);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(c.multi+"x", 0, -sh/2-19);

  const barW = sw * .78;
  ctx.fillStyle = "rgba(0,0,0,.35)";
  roundRect(-barW/2, sh/2+8, barW, 7, 4);
  ctx.fill();
  
  if (c.crack) {
    ctx.fillStyle = c.crack>.7 ? "#ffe66d" : "#7cf2ff";
    roundRect(-barW/2, sh/2+8, barW*c.crack, 7, 4);
    ctx.fill();
  }

  if(lockedCrate === c){
    ctx.strokeStyle = "#ffef5e";
    ctx.lineWidth = 3;
    ctx.setLineDash([7,5]);
    roundRect(-sw/2-8, -sh/2-8, sw+16, sh+16, 14);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function drawCannon(){
  const { cx, cy, cannonBtnW, cannonBtnH, cannonBtnOffset } = getUiLayout();
  const ang = Math.atan2(target.y-cy, target.x-cx);
  
  ctx.save();
  ctx.translate(cx,cy);
  ctx.rotate(ang);
  ctx.fillStyle = "#ffd36b";
  roundRect(0,-12,58,24,12); ctx.fill();
  ctx.strokeStyle = "#8b5a16"; ctx.lineWidth = 4; ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(cx,cy);
  ctx.fillStyle = "#4b6aff";
  ctx.beginPath(); ctx.arc(0,0,36,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = "#d9e2ff"; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(cannonLevel+"x",0,2);

  const btnY = -cannonBtnH / 2;
  ctx.fillStyle = "rgba(255,255,255,.20)";
  roundRect(-cannonBtnOffset - cannonBtnW/2, btnY, cannonBtnW, cannonBtnH, 12); ctx.fill();
  roundRect(cannonBtnOffset - cannonBtnW/2, btnY, cannonBtnW, cannonBtnH, 12); ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Arial";
  ctx.fillText("-", -cannonBtnOffset, 1);
  ctx.fillText("+", cannonBtnOffset, 1);

  ctx.restore();
}

function drawOpponentCannon(){
  if (!hasPeer) return;
  const cx = W/2, cy = 62;
  let sAngle = peerAngle;
  if (myRole === 'top') sAngle = peerAngle + Math.PI;
  
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(sAngle);
  ctx.fillStyle = "#ff6b6b";
  roundRect(0,-12,58,24,12); ctx.fill();
  ctx.strokeStyle = "#a92222"; ctx.lineWidth = 4; ctx.stroke();
  ctx.restore();
  
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#ff4b4b";
  ctx.beginPath(); ctx.arc(0,0,30,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = "#ffcccc"; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(peerLevel+"x",0,2);
  ctx.restore();
}

function drawUI(){
  ctx.fillStyle = "rgba(0,0,0,.35)";
  roundRect(16,H-90,190,42,16); ctx.fill();
  ctx.fillStyle = "#ffd76a";
  ctx.beginPath(); ctx.arc(39,H-69,13,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px Arial";
  ctx.textAlign = "left"; ctx.textBaseline="middle";
  ctx.fillText(Math.floor(coins), 60, H-69);

  ctx.font = "13px Arial";
  ctx.fillStyle = "rgba(255,255,255,.72)";
  ctx.fillText(t('cost') + cannonLevel + t('coins'), 16, H-35);

  ctx.fillStyle = "rgba(255,255,255,.62)";
  ctx.font = "12px Arial"; ctx.textAlign="right";
  const rate = totalShots ? Math.round(totalWins/totalShots*1000)/10 : 0;
  ctx.fillText(t('shots') + " " + totalShots + " / " + t('wins') + " " + totalWins + " / " + rate + "%", W-18, H-37);

  const { radius, spacing, startX, skillY } = getUiLayout();
  
  const btns = [
    {x: startX, label: autoFire ? t('auto') : t('manual'), sub: autoFire?t('on'):t('off'), active: autoFire, id: "auto"},
    {x: startX + spacing, label: t('lock'), sub: lockMode?t('on'):t('off'), active: lockMode, id: "lock"},
    {x: startX + spacing * 2, label: t('freeze'), sub: freezeCd>0 ? Math.ceil(freezeCd/60)+"s" : t('ready'), active: freezeTimer>0, id: "freeze"}
  ];

  for(const b of btns){
    ctx.beginPath();
    ctx.arc(b.x, skillY, radius, 0, Math.PI*2);
    ctx.fillStyle = b.active ? "rgba(124,242,255,.90)" : "rgba(255,255,255,.18)";
    if (b.id === 'freeze' && freezeCd > 0) ctx.fillStyle = "rgba(100,100,100,.5)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = b.active ? "#fff" : "rgba(255,255,255,.4)";
    ctx.stroke();

    ctx.fillStyle = b.active ? "#143044" : "#fff";
    ctx.font = "bold 14px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(b.label, b.x, skillY - 6);
    
    ctx.font = "11px Arial";
    ctx.fillStyle = b.active ? "#0a1822" : "rgba(255,255,255,.7)";
    ctx.fillText(b.sub, b.x, skillY + 10);
  }

  // Language toggle button
  ctx.beginPath();
  ctx.arc(W - 35, 30, 18, 0, Math.PI*2);
  ctx.fillStyle = "rgba(255,255,255,.15)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px Arial";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(t('langToggle'), W - 35, 30);
  
  // Switch Room button
  ctx.beginPath();
  ctx.arc(W - 85, 30, 18, 0, Math.PI*2);
  ctx.fillStyle = "rgba(233,69,96,.7)";
  ctx.fill();
  ctx.strokeStyle = "#ffb6c1";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 11px Arial";
  ctx.fillText(t('switchRoom'), W - 85, 30);
  
  // Room ID
  ctx.fillStyle = "rgba(255,255,255,.5)";
  ctx.font = "12px Arial";
  ctx.textAlign = "left";
  ctx.fillText(t('room') + (roomId || "..."), 16, 25);

  if(freezeTimer > 0){
    ctx.fillStyle = "rgba(124,220,255,.18)";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#dff8ff";
    ctx.font = "bold 18px Arial"; ctx.textAlign="center";
    ctx.fillText("FREEZE", W/2, H/2);
  }

  // Draw emote buttons
  const eStartX = 16;
  const eStartY = H/2 - 60;
  for (let i = 0; i < EMOJIS.length; i++) {
    ctx.beginPath();
    ctx.arc(eStartX + 20, eStartY + i * 45, 18, 0, Math.PI*2);
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.fill();
    ctx.font = "20px Arial";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(EMOJIS[i], eStartX + 20, eStartY + i * 45);
  }
}

function drawEmotes() {
  const { cx, cy } = getUiLayout();
  if (myEmoteTimer > 0) {
    ctx.globalAlpha = Math.min(1, myEmoteTimer/20);
    ctx.font = "36px Arial"; ctx.textAlign = "center";
    ctx.fillText(myEmote, cx, cy - 70 - (120 - myEmoteTimer)*0.3);
    ctx.globalAlpha = 1;
    myEmoteTimer--;
  }
  if (hasPeer && peerEmoteTimer > 0) {
    ctx.globalAlpha = Math.min(1, peerEmoteTimer/20);
    ctx.font = "36px Arial"; ctx.textAlign = "center";
    const peerY = myRole === 'bottom' ? 62 : H - 62;
    ctx.fillText(peerEmote, W/2, peerY + 90 + (120 - peerEmoteTimer)*0.3);
    ctx.globalAlpha = 1;
    peerEmoteTimer--;
  }
}

function draw(){
  ctx.save();
  ctx.clearRect(0,0,W,H);
  if(shake>0) ctx.translate((Math.random()-.5)*shake, (Math.random()-.5)*shake);

  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 2;
  for(let i=0;i<5;i++){
    ctx.beginPath();
    const y = H*.26 + i*75;
    ctx.moveTo(0,y);
    ctx.bezierCurveTo(W*.25,y+18,W*.75,y-18,W,y);
    ctx.stroke();
  }

  for(const c of crates) drawCrate(c);

  for(const b of bullets){
    const {x:sx, y:sy} = toScreen(b.lx, b.ly);
    ctx.save();
    ctx.shadowColor = "#fff6a6"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#fff0a0";
    ctx.beginPath(); ctx.arc(sx,sy,b.r,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  
  for(const b of peerBullets){
    const {x:sx, y:sy} = toScreen(b.lx, b.ly);
    ctx.save();
    ctx.shadowColor = "#ffbaba"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#ff8a8a";
    ctx.beginPath(); ctx.arc(sx,sy,4 + Math.log2(b.power+1)*1.5,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  for(const p of particles){
    ctx.globalAlpha = Math.max(0,p.life/35);
    ctx.fillStyle = "#ffe27a";
    ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  for(const cf of coinsFly){
    ctx.globalAlpha = Math.min(1, cf.life/20);
    ctx.fillStyle = "#ffd76a";
    ctx.beginPath(); ctx.arc(cf.x,cf.y,7,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawCannon();
  drawOpponentCannon();
  drawEmotes();

  for(const f of floatTexts){
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life/25));
    ctx.font = "bold "+f.size+"px Arial";
    ctx.textAlign="center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.strokeText(f.txt,f.x,f.y);
    ctx.fillStyle = f.txt[0] === "+" ? "#ffe66d" : "#ffffff";
    ctx.fillText(f.txt,f.x,f.y);
    ctx.globalAlpha = 1;
  }

  drawUI();

  if(paused){
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 36px Arial";
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(t('paused'), W/2, H/2);
  }

  ctx.restore();
}

let lastTime = 0;
let accumulator = 0;
function loop(timestamp){
  if (!lastTime) lastTime = timestamp;
  let dt = timestamp - lastTime;
  lastTime = timestamp;
  if (dt > 250) dt = 16.666; 
  accumulator += dt;
  while (accumulator >= 16.666) {
    update();
    accumulator -= 16.666;
  }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function isUiPoint(x,y){
  const { radius, spacing, startX, skillY, cannonBtnW, cannonBtnH, cannonBtnOffset, cx, cy } = getUiLayout();
  if(y>=cy-cannonBtnH/2 && y<=cy+cannonBtnH/2 && ((x>=cx-cannonBtnOffset-cannonBtnW/2 && x<=cx-cannonBtnOffset+cannonBtnW/2) || (x>=cx+cannonBtnOffset-cannonBtnW/2 && x<=cx+cannonBtnOffset+cannonBtnW/2))) return true;
  for(let i=0; i<3; i++){
    let bx = startX + i * spacing;
    if(Math.hypot(x - bx, y - skillY) <= radius) return true;
  }
  if (Math.hypot(x - (W - 35), y - 30) <= 18) return true;
  if (Math.hypot(x - (W - 85), y - 30) <= 18) return true;
  
  const eStartX = 16;
  const eStartY = H/2 - 60;
  for (let i = 0; i < EMOJIS.length; i++) {
    if (Math.hypot(x - (eStartX + 20), y - (eStartY + i * 45)) <= 18) return true;
  }
  return false;
}

function handleUiClick(x, y) {
  const { radius, spacing, startX, skillY, cannonBtnW, cannonBtnH, cannonBtnOffset, cx, cy } = getUiLayout();
  for(let i=0; i<3; i++){
    let bx = startX + i * spacing;
    if(Math.hypot(x - bx, y - skillY) <= radius){
      if(i === 0) { autoFire = !autoFire; return true; }
      if(i === 1) { lockMode = !lockMode; if(!lockMode) lockedCrate = null; return true; }
      if(i === 2) {
        if(freezeCd <= 0){
          freezeTimer = 300;
          freezeCd = 900;
          socket.emit('skill', { type: 'freeze' });
        }
        return true;
      }
    }
  }

  if (Math.hypot(x - (W - 35), y - 30) <= 18) {
    currentLang = currentLang === 'en' ? 'zh' : 'en';
    const hintEl = document.querySelector('.hint');
    if (hintEl) hintEl.innerText = t('hint');
    return true;
  }
  
  if (Math.hypot(x - (W - 85), y - 30) <= 18) {
    socket.emit('switch_room', {}, (res) => {
      // room_joined handles state clearing
    });
    return true;
  }

  if(y>=cy-cannonBtnH/2 && y<=cy+cannonBtnH/2) {
    if(x>=cx-cannonBtnOffset-cannonBtnW/2 && x<=cx-cannonBtnOffset+cannonBtnW/2) {
      adjustLevel(-1); return true;
    }
    if(x>=cx+cannonBtnOffset-cannonBtnW/2 && x<=cx+cannonBtnOffset+cannonBtnW/2) {
      adjustLevel(1); return true;
    }
  }

  const eStartX = 16;
  const eStartY = H/2 - 60;
  for (let i = 0; i < EMOJIS.length; i++) {
    if (Math.hypot(x - (eStartX + 20), y - (eStartY + i * 45)) <= 18) {
      if (myEmoteTimer <= 0) {
        myEmote = EMOJIS[i];
        myEmoteTimer = 120;
        socket.emit('emote', { emoji: myEmote });
      }
      return true;
    }
  }

  if(lockMode){
    const c = crateAt(x, y);
    if(c){ lockedCrate = c; target.x = x; target.y = y; return true; }
  }
  return false;
}

function setTarget(e){
  const rect = canvas.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  if(isUiPoint(p.clientX, p.clientY)) return;
  target.x = p.clientX - rect.left;
  target.y = p.clientY - rect.top;
}

canvas.addEventListener("mousemove", setTarget);
canvas.addEventListener("mousedown", e=>{ 
  if(isUiPoint(e.clientX, e.clientY)) {
    handleUiClick(e.clientX, e.clientY);
  } else {
    setTarget(e); 
    firing = true;
  }
});
window.addEventListener("mouseup", ()=> firing = false);

canvas.addEventListener("touchstart", e=>{ 
  e.preventDefault(); 
  const p=e.touches[0]; 
  if(isUiPoint(p.clientX, p.clientY)) {
    handleUiClick(p.clientX, p.clientY);
  } else {
    setTarget(e); 
    firing = true;
  }
}, {passive:false});
canvas.addEventListener("touchmove", e=>{ 
  e.preventDefault(); 
  setTarget(e); 
}, {passive:false});
canvas.addEventListener("touchend", ()=> firing = false);

window.addEventListener("keydown", e=>{
  if(e.key === " ") paused = !paused;
  if(e.key === "-" || e.key === "_") adjustLevel(-1);
  if(e.key === "=" || e.key === "+") adjustLevel(1);
});

function adjustLevel(delta){
  let idx = levels.indexOf(cannonLevel);
  idx = Math.max(0, Math.min(levels.length-1, idx + delta));
  cannonLevel = levels[idx];
}

document.addEventListener('DOMContentLoaded', () => {
    const hintEl = document.querySelector('.hint');
    if(hintEl) hintEl.innerText = t('hint');
});
