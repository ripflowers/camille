# Enstudy 生产上线说明

## 上线原则

- 生产环境必须运行 `server.mjs`，不能只发布静态文件；用户、学习进度、错题、练习记录都通过 `/api/users/*` 写入服务端。
- 生产用户数据目录是项目根目录下的 `storage/users/`。
- 升级时只替换程序文件，不覆盖、不清空、不同步删除线上 `storage/users/`。
- 上线前先备份线上 `storage/users/`，确认新版本启动和接口正常后再切换流量。
- 本版本保留服务端兼容迁移逻辑，老版本单词学习数据会在读取或保存用户时非破坏式补齐到新模式数据，不会覆盖已经存在的新进度。

## 推荐目录

```bash
/opt/enstudy/app             # 当前运行版本
/opt/enstudy/releases        # 版本包解压目录
/opt/enstudy/backups         # 用户数据备份
```

## 上线步骤

以下命令假设服务器运行目录是 `/opt/enstudy/app`，新包解压到 `/opt/enstudy/releases/enstudy-release-YYYYMMDD-HHMMSS-xxxxxxx`。

1. 备份线上用户数据。

```bash
mkdir -p /opt/enstudy/backups
tar -czf /opt/enstudy/backups/users-$(date +%Y%m%d-%H%M%S).tar.gz -C /opt/enstudy/app storage/users
```

2. 停止当前服务。

```bash
pm2 stop enstudy
```

如果没有使用 PM2，就用当前服务器实际的进程管理方式停止 `server.mjs`。

3. 保留线上用户数据，替换程序文件。

```bash
mkdir -p /opt/enstudy/releases
unzip enstudy-release-YYYYMMDD-HHMMSS-xxxxxxx.zip -d /opt/enstudy/releases/

PREV_APP=/opt/enstudy/app.prev-$(date +%Y%m%d-%H%M%S)
mv /opt/enstudy/app "$PREV_APP"
mv /opt/enstudy/releases/enstudy-release-YYYYMMDD-HHMMSS-xxxxxxx /opt/enstudy/app

mkdir -p /opt/enstudy/app/storage
cp -a "$PREV_APP/storage/users" /opt/enstudy/app/storage/users
```

注意：不要使用会删除目标多余文件的整目录 `rsync --delete` 覆盖 `/opt/enstudy/app`，否则可能误删线上用户数据。

4. 安装生产依赖并启动。

```bash
cd /opt/enstudy/app
npm ci --omit=dev
PORT=4173 pm2 start server.mjs --name enstudy
pm2 save
```

如果已经有同名 PM2 服务：

```bash
cd /opt/enstudy/app
npm ci --omit=dev
PORT=4173 pm2 restart enstudy --update-env
```

5. 验证服务。

```bash
curl -fsS http://127.0.0.1:4173/api/health
curl -fsS http://127.0.0.1:4173/api/users
```

期望 `/api/health` 返回 `{"ok":true}`，`/api/users` 能看到原来的用户列表。

6. 验证页面。

- 打开 `/sentence.html`，确认句子学习可进入。
- 打开 `/primary.html`，确认单词学习可进入。
- 在用户选择页确认原用户可见。
- 用一个测试用户答一题，刷新页面后确认进度仍在。

## Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

iPad PWA 正式使用建议配置 HTTPS。否则 Safari 添加到主屏幕和 Service Worker 可能受限制。

## 回滚

如果上线后发现问题：

```bash
pm2 stop enstudy
mv /opt/enstudy/app /opt/enstudy/app.bad-$(date +%Y%m%d-%H%M%S)
mv /opt/enstudy/app.prev-YYYYMMDD-HHMMSS /opt/enstudy/app
cd /opt/enstudy/app
PORT=4173 pm2 start server.mjs --name enstudy
```

如果用户数据被误操作，再从备份恢复：

```bash
cd /opt/enstudy/app
rm -rf storage/users
tar -xzf /opt/enstudy/backups/users-YYYYMMDD-HHMMSS.tar.gz -C /opt/enstudy/app
```
