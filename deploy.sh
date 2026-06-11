#!/bin/bash
# 一键部署脚本：适配多种 Linux 发行版，安装 Node.js，配置 Systemd 守护进程
set -e

echo "========================================="
echo "  Lucky Crate Cannon - Linux 一键部署脚本 "
echo "========================================="

if [ "$EUID" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "[1/4] 检测系统包管理器并安装基础组件..."

if command -v apt-get >/dev/null; then
    PKG_MGR="apt"
    $SUDO apt-get update -y
    $SUDO apt-get install -y curl
elif command -v dnf >/dev/null; then
    PKG_MGR="dnf"
    $SUDO dnf install -y curl
elif command -v yum >/dev/null; then
    PKG_MGR="yum"
    $SUDO yum install -y curl
elif command -v pacman >/dev/null; then
    PKG_MGR="pacman"
    $SUDO pacman -Sy --noconfirm curl
elif command -v zypper >/dev/null; then
    PKG_MGR="zypper"
    $SUDO zypper install -y curl
else
    echo "未找到受支持的包管理器 (apt/yum/dnf/pacman/zypper)。"
    exit 1
fi

echo "[2/4] 检查并安装 Node.js..."
if ! command -v node &> /dev/null
then
    echo "未找到 Node.js，正在根据系统 ($PKG_MGR) 安装 Node.js 18.x..."
    if [ "$PKG_MGR" = "apt" ]; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | $SUDO bash -
        $SUDO apt-get install -y nodejs
    elif [ "$PKG_MGR" = "yum" ] || [ "$PKG_MGR" = "dnf" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_18.x | $SUDO bash -
        $SUDO $PKG_MGR install -y nodejs
    elif [ "$PKG_MGR" = "pacman" ]; then
        $SUDO pacman -S --noconfirm nodejs npm
    elif [ "$PKG_MGR" = "zypper" ]; then
        $SUDO zypper in -y nodejs18 npm18 || $SUDO zypper in -y nodejs npm
    fi
else
    echo "已安装 Node.js: $(node -v)"
fi

echo "[3/4] 安装项目依赖..."
npm install

echo "[3.5/4] 混淆前端代码..."
if command -v npx >/dev/null; then
    npx javascript-obfuscator game.js --output game.js
else
    echo "未找到 npx，跳过前端代码混淆。"
fi

echo "[4/4] 配置 Systemd 服务..."
SERVICE_FILE="/etc/systemd/system/lucky-crate.service"
WORK_DIR=$(pwd)
NODE_BIN=$(command -v node)

$SUDO bash -c "cat > $SERVICE_FILE" << EOF
[Unit]
Description=Lucky Crate Cannon Server
After=network.target

[Service]
ExecStart=$NODE_BIN $WORK_DIR/server.js
WorkingDirectory=$WORK_DIR
Restart=always
User=$USER
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable lucky-crate
$SUDO systemctl restart lucky-crate

echo "========================================="
echo "部署完成！"
echo "游戏前端页面请访问: http://你的服务器IP:3000"
echo "游戏后台管理请访问: http://你的服务器IP:3000/admin"
echo "使用 'sudo systemctl status lucky-crate' 查看运行状态。"
echo "使用 'sudo journalctl -u lucky-crate -f' 查看实时运行日志。"
echo "========================================="
