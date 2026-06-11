#!/bin/bash
# 一键部署/更新脚本：适配多种 Linux，支持自动 Git 拉取、防端口冲突、配置 Systemd
set -e

echo "========================================="
echo "  Lucky Crate Cannon - Linux 一键部署/更新脚本 "
echo "========================================="

if [ "$EUID" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "[1/7] 尝试停止旧的本服务进程..."
if $SUDO systemctl is-active --quiet lucky-crate; then
    echo "发现正在运行的 lucky-crate 服务，正在安全停止以防端口冲突..."
    $SUDO systemctl stop lucky-crate
    echo "服务已停止。"
else
    echo "未发现运行中的 lucky-crate 服务。"
fi

echo "[2/7] 检查并从 Git 拉取最新代码..."
if [ -d ".git" ]; then
    if command -v git >/dev/null; then
        echo "正在执行 git pull 获取最新更新..."
        git pull || echo "Git 拉取失败或有冲突，将继续使用本地现有代码。"
    else
        echo "系统未安装 git，跳过代码拉取。"
    fi
else
    echo "当前目录不是 git 仓库，跳过自动更新。"
fi

echo "[3/7] 检测系统包管理器并安装基础组件..."
if command -v apt-get >/dev/null; then
    PKG_MGR="apt"
    $SUDO apt-get update -y
    $SUDO apt-get install -y curl git
elif command -v dnf >/dev/null; then
    PKG_MGR="dnf"
    $SUDO dnf install -y curl git
elif command -v yum >/dev/null; then
    PKG_MGR="yum"
    $SUDO yum install -y curl git
elif command -v pacman >/dev/null; then
    PKG_MGR="pacman"
    $SUDO pacman -Sy --noconfirm curl git
elif command -v zypper >/dev/null; then
    PKG_MGR="zypper"
    $SUDO zypper install -y curl git
else
    echo "未找到受支持的包管理器 (apt/yum/dnf/pacman/zypper)。"
    exit 1
fi

echo "[4/7] 检查并安装 Node.js..."
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

echo "[5/7] 安装项目依赖并混淆代码..."
npm install

if command -v npx >/dev/null; then
    echo "正在混淆前端代码..."
    npx javascript-obfuscator game.js --output game.js
else
    echo "未找到 npx，跳过前端代码混淆。"
fi

echo "[6/7] 检查端口占用情况..."
PORT_CONFLICT=0
if command -v ss >/dev/null; then
    if $SUDO ss -tuln | grep ":3000 " > /dev/null; then
        PORT_CONFLICT=1
    fi
elif command -v netstat >/dev/null; then
    if $SUDO netstat -tuln | grep ":3000 " > /dev/null; then
        PORT_CONFLICT=1
    fi
fi

if [ "$PORT_CONFLICT" -eq 1 ]; then
    echo "⚠️ 严重警告：端口 3000 仍被其他未知服务占用！本服务启动可能会失败。请检查并释放端口 3000。"
else
    echo "端口 3000 状态正常空闲。"
fi

echo "[7/7] 配置并启动 Systemd 服务..."
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
echo "更新/部署完成！"
echo "游戏前端页面请访问: http://你的服务器IP:3000"
echo "游戏后台管理请访问: http://你的服务器IP:3000/admin"
echo "========================================="
