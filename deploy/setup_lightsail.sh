#!/usr/bin/env bash
set -euo pipefail

# Simple Lightsail setup script for PLADIM
# Usage: bash setup_lightsail.sh DOMAIN

DOMAIN=${1:-}
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 DOMAIN" >&2
  exit 1
fi

# Update system
sudo apt-get update -y
sudo apt-get upgrade -y

# Install basic tools
sudo apt-get install -y git curl build-essential

# Install Node.js LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm i -g pm2

# Install Nginx
sudo apt-get install -y nginx

# Configure Nginx site
sudo mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
sudo cp ./deploy/nginx/pladim.conf /etc/nginx/sites-available/pladim
sudo sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" /etc/nginx/sites-available/pladim
sudo ln -sf /etc/nginx/sites-available/pladim /etc/nginx/sites-enabled/pladim

# Remove default site if exists
sudo rm -f /etc/nginx/sites-enabled/default

# Restart Nginx
sudo systemctl restart nginx

# Create app data directory
mkdir -p data

# Install app dependencies
npm install

# Setup environment file
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Please edit .env with your production credentials (GOOGLE_CLIENT_ID/SECRET, GOOGLE_CALLBACK_URL, SESSION_SECRET)."
fi

# Start app with PM2
pm2 start npm --name pladim -- start
pm2 save

# Enable PM2 startup at boot
PM2_STARTUP_CMD=$(pm2 startup systemd -u $USER --hp $HOME | tail -n 1)
eval $PM2_STARTUP_CMD

# Show status
pm2 status
systemctl status nginx --no-pager || true

echo "Setup complete. Visit: http://$DOMAIN/"