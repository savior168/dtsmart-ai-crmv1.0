# DTSmart AI获客CRM：Vercel部署

项目已按Next.js App Router标准配置。Vercel会识别 `pnpm-lock.yaml` 和 `package.json` 中声明的pnpm版本，并使用 `npm run build` 对应的生产构建流程。

## 1. 上传到GitHub

1. 登录GitHub，创建一个新的私有仓库，例如 `dtsmart-ai-crm`。
2. 创建仓库时不要添加README、`.gitignore` 或License，避免首次推送冲突。
3. 在项目目录执行：

```bash
git branch -M main
git remote add origin https://github.com/<你的GitHub账号>/dtsmart-ai-crm.git
git push -u origin main
```

如果已经配置过 `origin`，使用以下命令更新：

```bash
git remote set-url origin https://github.com/<你的GitHub账号>/dtsmart-ai-crm.git
git push -u origin main
```

## 2. 导入到Vercel

1. 登录 [Vercel Dashboard](https://vercel.com/dashboard)。
2. 点击 **Add New → Project**。
3. 连接GitHub并选择刚上传的 `dtsmart-ai-crm` 仓库。
4. Framework Preset保持 **Next.js**。
5. Root Directory保持仓库根目录，Build Command和Output Directory保持默认。
6. 部署前先添加以下环境变量。

Vercel支持直接导入Git仓库，并会为后续分支提交自动创建部署。参考：[Vercel Git部署文档](https://vercel.com/docs/git)。

## 3. 添加生产环境变量

在Vercel项目的 **Settings → Environment Variables** 添加：

```env
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的Supabase匿名密钥
OPENAI_API_KEY=你的OpenAI API密钥
```

三个变量至少勾选 **Production**。如果Preview环境也要测试登录、数据库和AI功能，同时勾选 **Preview**。

- `NEXT_PUBLIC_SUPABASE_URL`：Supabase Dashboard → Project Settings → API中的Project URL。
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`：同一页面的anon/public或Publishable key。
- `OPENAI_API_KEY`：只作为服务端密钥配置，禁止增加 `NEXT_PUBLIC_` 前缀或提交到Git。

环境变量配置参考：[Vercel环境变量文档](https://vercel.com/docs/environment-variables)。

管理员初始化脚本使用的 `SUPABASE_SERVICE_ROLE_KEY`、`ADMIN_NAME`、`ADMIN_EMAIL`、`ADMIN_PASSWORD` 只用于本地一次性初始化，不是Vercel运行必需变量。

## 4. 准备Supabase

1. 在Supabase SQL Editor完整执行 `supabase/FINAL_DATABASE_SETUP.sql`。
2. 在Supabase Dashboard → Authentication → URL Configuration中，将Vercel正式域名设置为Site URL。
3. 将 `https://你的域名.vercel.app/**` 加入允许的Redirect URLs。
4. 确认至少存在一个状态为ACTIVE的ADMIN用户。

## 5. 部署与验证

1. 返回Vercel导入页面，点击 **Deploy**。
2. 等待构建成功并打开Vercel分配的正式域名。
3. 依次验证：
   - `/supabase-test` 显示Supabase连接成功；
   - `/login` 可以使用ADMIN账号登录；
   - Dashboard与 `/reports` 可以读取统计数据；
   - `/customers` 可以读取、认领和跟进客户；
   - 配置OpenAI Key后，单客户及批量AI分析成功。

Next.js项目在Vercel上使用零配置部署能力。参考：[Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)。

## 6. 后续更新

代码更新后执行：

```bash
git add .
git commit -m "描述本次更新"
git push
```

Vercel会在GitHub推送后自动触发新的部署。
