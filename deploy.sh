#!/bin/bash
# =============================================
# 艺卷点餐系统 — 一键部署脚本
# 适用：Ubuntu 20.04/22.04
# =============================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}"
echo "  ╔══════════════════════════════╗"
echo "  ║    🍵 艺卷 · 一键部署脚本    ║"
echo "  ╚══════════════════════════════╝"
echo -e "${NC}"

# 检查是否 root
if [ "$(id -u)" != "0" ]; then
   echo -e "${RED}请用 root 用户运行: sudo bash deploy.sh${NC}"
   exit 1
fi

# 获取域名
if [ -z "$1" ]; then
    read -p "请输入你的域名（如 yijuan.top）：" DOMAIN
else
    DOMAIN="$1"
fi

APP_DIR="/opt/yijuan-order"
NODE_VERSION="22.x"

echo -e "${YELLOW}📦 1/6 更新系统...${NC}"
apt update -y && apt upgrade -y

echo -e "${YELLOW}📦 2/6 安装 Node.js ${NODE_VERSION}...${NC}"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

echo -e "${YELLOW}📦 3/6 安装 Nginx...${NC}"
apt install -y nginx

echo -e "${YELLOW}📦 4/6 部署应用...${NC}"
# 如果目录已存在则备份
if [ -d "$APP_DIR" ]; then
    cp -r "$APP_DIR" "${APP_DIR}_backup_$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
fi

# 创建目录并复制文件（文件需提前上传到 /tmp/yijuan-order）
mkdir -p "$APP_DIR"
if [ -d "/tmp/yijuan-order" ]; then
    cp -r /tmp/yijuan-order/* "$APP_DIR/"
else
    echo -e "${RED}请先将 yijuan-order 文件夹上传到 /tmp/yijuan-order${NC}"
    echo "  方法：scp -r yijuan-order root@你的服务器IP:/tmp/"
    exit 1
fi

cd "$APP_DIR"
npm install --production

echo -e "${YELLOW}📦 5/6 配置 Nginx...${NC}"
cat > /etc/nginx/sites-available/yijuan << NGINXCONF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # 静态文件缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
        proxy_pass http://127.0.0.1:3000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINXCONF

ln -sf /etc/nginx/sites-available/yijuan /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo -e "${YELLOW}📦 6/6 安装 PM2 + 启动服务...${NC}"
npm install -g pm2
pm2 start server.js --name yijuan --cwd "$APP_DIR"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# SSL 证书（Let's Encrypt）
echo ""
read -p "是否安装 HTTPS 证书？（推荐，需域名已解析到此服务器）[Y/n]：" SSL
if [[ "$SSL" != "n" && "$SSL" != "N" ]]; then
    apt install -y certbot python3-certbot-nginx
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@${DOMAIN}" --redirect || true
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  ✅ 部署完成！${NC}"
echo -e "${GREEN}  🌐 访问地址: http://${DOMAIN}${NC}"
echo -e "${GREEN}  📋 管理后台: http://${DOMAIN}/admin.html${NC}"
echo -e "${GREEN}  🔑 管理密码: yijuan888${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${YELLOW}常用命令：${NC}"
echo "  pm2 status        # 查看服务状态"
echo "  pm2 logs yijuan   # 查看日志"
echo "  pm2 restart yijuan # 重启服务"
echo "  pm2 stop yijuan   # 停止服务"
