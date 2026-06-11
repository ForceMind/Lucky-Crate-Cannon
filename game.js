const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

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
    langToggle: "EN"
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
    langToggle: "中"
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

const boxTypes = [
  {nameIdx:0, color:"#B97843", edge:"#7b4a25", multi:2,   chance:.5, w:62, h:48, speed:.85, weight:26},
  {nameIdx:1, color:"#3CC47C", edge:"#197646", multi:3,   chance:.333333, w:64, h:50, speed:.78, weight:20},
  {nameIdx:2, color:"#3E8BFF", edge:"#1f4f9e", multi:5,   chance:.2, w:66, h:52, speed:.70, weight:16},
  {nameIdx:3, color:"#9B5CFF", edge:"#5c2bb2", multi:8,   chance:.125,w:70, h:54, speed:.62, weight:11},
  {nameIdx:4, color:"#FF5656", edge:"#a92222", multi:12,  chance:.083333,w:72, h:56, speed:.56, weight:8},
  {nameIdx:5, color:"#C9D2DE", edge:"#6d7a8a", multi:20,  chance:.05,w:76, h:58, speed:.50, weight:6},
  {nameIdx:6, color:"#FFC83D", edge:"#b57b00", multi:30,  chance:.033333,w:80, h:60, speed:.43, weight:5},
  {nameIdx:7, color:"#35E9E1", edge:"#008d8a", multi:50,chance:.02,w:84, h:62, speed:.36, weight:3},
  {nameIdx:8, color:"#FF9D26", edge:"#b04d00", multi:100,chance:.01,w:92, h:66, speed:.30, weight:2},
  {nameIdx:9, color:"#F567FF", edge:"#8120a0", multi:300,chance:.003333,w:102,h:72, speed:.24, weight:1}
];

let coins = 1000;
let cannonLevel = 1;
const levels = [1,2,5,10];
let bullets = [], crates = [], particles = [], floatTexts = [], coinsFly = [];
let target = {x: W/2, y: H/2};
let firing = false;
let autoFire = false;
let lockMode = false;
let lockedCrate = null;
let freezeCd = 0;
let freezeTimer = 0;
let fireCd = 0;
let spawnCd = 0;
let paused = false;
let shake = 0;
let totalShots = 0, totalWins = 0;

function weightedType(){
  const total = boxTypes.reduce((s,b)=>s+b.weight,0);
  let r = Math.random()*total;
  for(const b of boxTypes){ r -= b.weight; if(r <= 0) return b; }
  return boxTypes[0];
}

function spawnGroup(){
  const count = Math.floor(3 + Math.random()*6);
  const twoRows = Math.random() < .45;
  const dir = Math.random() < .5 ? 1 : -1;
  const startX = dir > 0 ? -130 : W + 130;
  const baseY = H * (0.30 + Math.random()*0.20);
  const gap = 82;
  const groupSpeedScale = .55 + Math.random()*.35;
  for(let i=0;i<count;i++){
    const t = weightedType();
    const row = twoRows ? (i % 2) : 0;
    const y = baseY + row * gap + Math.sin(i*.7)*10;
    const x = startX - dir * i * (t.w + 18);
    crates.push({
      type:t, x, y, w:t.w, h:t.h,
      vx: dir * t.speed * groupSpeedScale,
      bob: Math.random()*Math.PI*2,
      hitFlash:0,
      crack:0,
      slow:0,
      alive:true,
      labelLife: 90,
      expectedHits: t.multi,
      progressHits: 0
    });
  }
}

function fire(){
  if(coins < cannonLevel) return;
  coins -= cannonLevel;
  totalShots++;
  const cx = W/2, cy = H - 62;
  let aimX = target.x, aimY = target.y;
  if(lockMode && lockedCrate && lockedCrate.alive){
    aimX = lockedCrate.x;
    aimY = lockedCrate.y;
  }
  let dx = aimX - cx, dy = aimY - cy;
  const len = Math.max(1, Math.hypot(dx,dy));
  dx /= len; dy /= len;
  bullets.push({
    x: cx + dx*38, y: cy + dy*38,
    vx: dx * 13, vy: dy * 13,
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
    if(c.alive && x > c.x-c.w/2 && x < c.x+c.w/2 && y > c.y-c.h/2 && y < c.y+c.h/2) return c;
  }
  return null;
}

function hitCrate(crate, bullet){
  crate.hitFlash = 10;
  crate.slow = 28;
  crate.progressHits += 1;
  crate.crack = Math.min(1, crate.progressHits / crate.expectedHits);

  for(let i=0;i<6;i++){
    particles.push({x:bullet.x, y:bullet.y, vx:(Math.random()-.5)*5, vy:(Math.random()-.5)*5, life:22, size:2+Math.random()*3});
  }

  fetch('/api/hit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ multi: crate.type.multi, power: bullet.power })
  })
  .then(res => res.json())
  .then(data => {
    if(data.win){
      crate.alive = false;
      if(lockedCrate === crate) lockedCrate = null;
      const reward = bullet.power * crate.type.multi;
      coins += reward;
      totalWins++;
      floatTexts.push({x:crate.x, y:crate.y-35, txt:"+"+reward, life:70, size:24, rise:1.1});
      for(let i=0;i<18;i++){
        particles.push({x:crate.x, y:crate.y, vx:(Math.random()-.5)*9, vy:(Math.random()-.5)*9, life:35, size:3+Math.random()*5});
      }
      for(let i=0;i<8;i++){
        coinsFly.push({x:crate.x+(Math.random()-.5)*40, y:crate.y+(Math.random()-.5)*30, tx:78, ty:32, life:45+i*2});
      }
      shake = 8;
    } else {
      const missText = crate.crack > .65 ? t('almostBreak') : t('hit');
      floatTexts.push({x:bullet.x, y:bullet.y-12, txt:missText, life:28, size:15, rise:.75});
    }
  })
  .catch(err => {
    console.error("Hit request failed", err);
  });
}

function update(){
  if(paused) return;
  if(shake > 0) shake *= .82;

  spawnCd--;
  if(spawnCd <= 0){
    spawnGroup();
    spawnCd = 95 + Math.random()*70;
  }

  if(firing || autoFire){
    if(fireCd <= 0) fire();
  }
  if(fireCd > 0) fireCd--;
  if(freezeCd > 0) freezeCd--;
  if(freezeTimer > 0) freezeTimer--;

  for(const c of crates){
    const slowMul = freezeTimer > 0 ? 0 : (c.slow > 0 ? .28 : 1);
    c.x += c.vx * slowMul;
    c.bob += freezeTimer > 0 ? 0 : .035;
    if(c.hitFlash > 0) c.hitFlash--;
    if(c.slow > 0) c.slow--;
    if(c.labelLife > 0) c.labelLife--;
  }
  crates = crates.filter(c => c.alive && c.x > -180 && c.x < W+180);
  if(lockedCrate && (!lockedCrate.alive || !crates.includes(lockedCrate))) {
    lockedCrate = null;
  }
  
  if (lockMode && !lockedCrate && crates.length > 0) {
    let highestMulti = 0;
    let bestCrate = null;
    for (const c of crates) {
      if (c.type.multi > highestMulti) {
        highestMulti = c.type.multi;
        bestCrate = c;
      }
    }
    lockedCrate = bestCrate;
  }

  for(const b of bullets){
    if(b.lockedTarget && b.lockedTarget.alive){
      const c = b.lockedTarget;
      const dx = c.x - b.x, dy = c.y - b.y;
      const d = Math.max(1, Math.hypot(dx,dy));
      const speed = 14;
      b.vx = dx / d * speed;
      b.vy = dy / d * speed;
      b.x += b.vx; b.y += b.vy;
      if(b.x > c.x-c.w/2 && b.x < c.x+c.w/2 && b.y > c.y-c.h/2 && b.y < c.y+c.h/2){
        b.life = 0;
        hitCrate(c,b);
      }
    } else {
      b.x += b.vx; b.y += b.vy;
      if(b.x < b.r){ b.x = b.r; b.vx *= -1; }
      if(b.x > W - b.r){ b.x = W - b.r; b.vx *= -1; }
      if(b.y < b.r){ b.y = b.r; b.vy *= -1; }
      if(b.y > H - b.r){ b.y = H - b.r; b.vy *= -1; }
      for(const c of crates){
        if(!c.alive) continue;
        if(b.x > c.x-c.w/2 && b.x < c.x+c.w/2 && b.y > c.y-c.h/2 && b.y < c.y+c.h/2){
          b.life = 0;
          hitCrate(c,b);
          break;
        }
      }
    }
  }
  bullets = bullets.filter(b => b.life > 0);

  for(const p of particles){ p.x += p.vx; p.y += p.vy; p.vy += .08; p.life--; }
  particles = particles.filter(p=>p.life>0);

  for(const f of floatTexts){ f.y -= f.rise; f.life--; }
  floatTexts = floatTexts.filter(f=>f.life>0);

  for(const cf of coinsFly){
    const t = .13;
    cf.x += (cf.tx - cf.x)*t;
    cf.y += (cf.ty - cf.y)*t;
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

function drawCrate(c){
  const tInfo = c.type;
  const y = c.y + Math.sin(c.bob)*5;
  ctx.save();
  ctx.translate(c.x, y);
  if(c.hitFlash>0) ctx.scale(1.06,1.06);

  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  roundRect(-c.w/2,-c.h/2,c.w,c.h,10);
  ctx.fillStyle = c.hitFlash>0 ? "#fff4bf" : tInfo.color;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = tInfo.edge;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.globalAlpha = .78;
  ctx.fillStyle = tInfo.edge;
  ctx.fillRect(-c.w/2+8, -5, c.w-16, 10);
  ctx.fillRect(-6, -c.h/2+6, 12, c.h-12);

  if(c.crack > .12){
    ctx.globalAlpha = Math.min(.95, c.crack + .15);
    ctx.strokeStyle = "rgba(35,25,20,.95)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-8, -c.h*.32);
    ctx.lineTo(0, -c.h*.12);
    ctx.lineTo(-5, c.h*.02);
    ctx.lineTo(8, c.h*.20);
    if(c.crack>.45){ ctx.moveTo(0,-c.h*.12); ctx.lineTo(16,-c.h*.25); }
    if(c.crack>.7){ ctx.moveTo(-5,c.h*.02); ctx.lineTo(-20,c.h*.18); }
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0,0,0,.52)";
  roundRect(-28, -c.h/2-30, 56, 21, 10);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tInfo.multi+"x", 0, -c.h/2-19);

  const barW = c.w * .78;
  ctx.fillStyle = "rgba(0,0,0,.35)";
  roundRect(-barW/2, c.h/2+8, barW, 7, 4);
  ctx.fill();
  ctx.fillStyle = c.crack>.7 ? "#ffe66d" : "#7cf2ff";
  roundRect(-barW/2, c.h/2+8, barW*c.crack, 7, 4);
  ctx.fill();

  if(lockedCrate === c){
    ctx.strokeStyle = "#ffef5e";
    ctx.lineWidth = 3;
    ctx.setLineDash([7,5]);
    roundRect(-c.w/2-8, -c.h/2-8, c.w+16, c.h+16, 14);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function drawCannon(){
  const cx = W/2, cy = H - 62;
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

  const bw = 42, bh = 34;
  ctx.fillStyle = "rgba(255,255,255,.20)";
  roundRect(-92, -17, bw, bh, 12); ctx.fill();
  roundRect(50, -17, bw, bh, 12); ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Arial";
  ctx.fillText("-", -71, 1);
  ctx.fillText("+", 71, 1);

  ctx.restore();
}

function drawUI(){
  ctx.fillStyle = "rgba(0,0,0,.35)";
  roundRect(16,14,190,42,16); ctx.fill();
  ctx.fillStyle = "#ffd76a";
  ctx.beginPath(); ctx.arc(39,35,13,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px Arial";
  ctx.textAlign = "left"; ctx.textBaseline="middle";
  ctx.fillText(Math.floor(coins), 60, 35);

  ctx.font = "13px Arial";
  ctx.fillStyle = "rgba(255,255,255,.72)";
  ctx.fillText(t('cost') + cannonLevel + t('coins'), 16, 70);

  ctx.fillStyle = "rgba(255,255,255,.62)";
  ctx.font = "12px Arial"; ctx.textAlign="right";
  const rate = totalShots ? Math.round(totalWins/totalShots*1000)/10 : 0;
  ctx.fillText(t('shots') + " " + totalShots + " / " + t('wins') + " " + totalWins + " / " + rate + "%", W-18, 68);

  // circular buttons
  const radius = 30;
  const spacing = 75;
  const startX = W - spacing * 3 + 10;
  const skillY = H - 45;
  
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

  // Language toggle button (top right corner)
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

  if(freezeTimer > 0){
    ctx.fillStyle = "rgba(124,220,255,.18)";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#dff8ff";
    ctx.font = "bold 18px Arial"; ctx.textAlign="center";
    ctx.fillText("FREEZE", W/2, 104);
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
    ctx.save();
    ctx.shadowColor = "#fff6a6"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#fff0a0";
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
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

function loop(){
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();

function isUiPoint(x,y){
  const cx = W/2, cy = H - 62;
  const radius = 30;
  const spacing = 75;
  const startX = W - spacing * 3 + 10;
  const skillY = H - 45;
  
  if(y>=cy-17 && y<=cy+17 && ((x>=cx-92 && x<=cx-50) || (x>=cx+50 && x<=cx+92))) return true;
  
  for(let i=0; i<3; i++){
    let bx = startX + i * spacing;
    if(Math.hypot(x - bx, y - skillY) <= radius) return true;
  }
  
  // Language toggle
  if (Math.hypot(x - (W - 35), y - 30) <= 18) return true;

  return false;
}

function setTarget(e){
  const rect = canvas.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  target.x = p.clientX - rect.left;
  target.y = p.clientY - rect.top;
}

canvas.addEventListener("mousemove", setTarget);
canvas.addEventListener("mousedown", e=>{ setTarget(e); if(!isUiPoint(e.clientX,e.clientY)) firing = true; });
window.addEventListener("mouseup", ()=> firing = false);
canvas.addEventListener("touchstart", e=>{ e.preventDefault(); setTarget(e); const p=e.touches[0]; if(!isUiPoint(p.clientX,p.clientY)) firing = true; }, {passive:false});
canvas.addEventListener("touchmove", e=>{ e.preventDefault(); setTarget(e); }, {passive:false});
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
canvas.addEventListener("click", e=>{
  const cx = W/2, cy = H - 62;

  const radius = 30;
  const spacing = 75;
  const startX = W - spacing * 3 + 10;
  const skillY = H - 45;
  
  for(let i=0; i<3; i++){
    let bx = startX + i * spacing;
    if(Math.hypot(e.clientX - bx, e.clientY - skillY) <= radius){
      if(i === 0) { autoFire = !autoFire; return; }
      if(i === 1) { lockMode = !lockMode; if(!lockMode) lockedCrate = null; return; }
      if(i === 2) {
        if(freezeCd <= 0){
          freezeTimer = 300;
          freezeCd = 900;
        }
        return;
      }
    }
  }

  // lang toggle
  if (Math.hypot(e.clientX - (W - 35), e.clientY - 30) <= 18) {
    currentLang = currentLang === 'en' ? 'zh' : 'en';
    const hintEl = document.querySelector('.hint');
    if (hintEl) hintEl.innerText = t('hint');
    return;
  }

  if(e.clientX>=cx-92 && e.clientX<=cx-50 && e.clientY>=cy-17 && e.clientY<=cy+17) {
    adjustLevel(-1);
    return;
  }
  if(e.clientX>=cx+50 && e.clientX<=cx+92 && e.clientY>=cy-17 && e.clientY<=cy+17) {
    adjustLevel(1);
    return;
  }

  if(lockMode){
    const c = crateAt(e.clientX, e.clientY);
    if(c){ lockedCrate = c; target.x = c.x; target.y = c.y; return; }
  }
});

for(let i=0;i<2;i++) setTimeout(spawnGroup, i*600);

document.addEventListener('DOMContentLoaded', () => {
    const hintEl = document.querySelector('.hint');
    if(hintEl) hintEl.innerText = t('hint');
});
