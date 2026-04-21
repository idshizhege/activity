# GitHub Pages + Supabase 部署说明

## 1. 创建 Supabase 项目

1. 打开 Supabase，新建一个项目。
2. 进入 SQL Editor，执行 `web/supabase-schema.sql`。
3. 进入 Authentication，创建一个管理员账号（邮箱 + 密码）。
4. 记下以下信息：
   - Project URL
   - anon public key
   - 管理员邮箱

## 2. 本地配置

在 `web` 目录下复制环境变量模板：

```bash
cp web/.env.example web/.env
```

填写：

```env
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_ANON_KEY=你的匿名key
VITE_ADMIN_EMAIL=你的管理员邮箱
```

## 3. 本地运行

```bash
cd web
npm install
npm run dev
```

- 公开报名页：`http://localhost:5173/`
- 管理编辑页：`http://localhost:5173/?mode=admin`

## 4. 上传到 GitHub

```bash
git add .
git commit -m "Add GitHub Pages + Supabase activity page"
git push origin main
```

## 5. 配置 GitHub Secrets

仓库 `Settings -> Secrets and variables -> Actions` 里添加：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ADMIN_EMAIL`

## 6. 开启 GitHub Pages

1. 打开仓库 `Settings -> Pages`
2. Source 选择 `GitHub Actions`
3. 推送到 `main` 后会自动部署

## 7. 部署后的地址

- 公开报名页：`https://你的用户名.github.io/仓库名/`
- 管理编辑页：`https://你的用户名.github.io/仓库名/?mode=admin`

## 8. 注意事项

- GitHub Pages 只托管前端页面；数据实际保存在 Supabase。
- 这个版本不再依赖 `web/server.mjs`。
- 当前 `participants` 更新策略为了简单开放了匿名更新，更适合小范围熟人群活动，不适合高安全场景。
- 如果后续你要更安全，我可以继续帮你改成 `Supabase Auth + 更严格 RLS` 或 `Edge Functions` 版本。
