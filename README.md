# DTSmart AI获客CRM

基于 Next.js App Router、TypeScript、Tailwind CSS 和 Supabase 的客户筛选与 CRM 系统，可部署到 Vercel。

## 本地运行

1. 复制 `.env.example` 为 `.env.local` 并填写 Supabase 配置。
2. 安装依赖：`npm install`
3. 启动开发服务：`npm run dev`
4. 打开 `http://localhost:3000`

## 数据库初始化

当前数据库通过 Supabase SQL Editor 初始化，不依赖 Supabase CLI：

1. 登录 Supabase Dashboard，并打开目标项目。
2. 进入 **SQL Editor**，点击 **New query**。
3. 打开 `supabase/manual_setup.sql`，复制文件中的全部 SQL。
4. 粘贴到 SQL Editor 并点击 **Run**。
5. 确认 `users`、`departments`、`customers`、`customer_claims`、`customer_protection`、`followups`、`import_tasks` 和 `audit_logs` 共 8 张表已创建。
6. 确认 8 张表均已启用 RLS。

完整的执行、验证及 ADMIN 初始化步骤见 `SUPABASE_MANUAL_SETUP.md`。

不要执行早期演示文件 `supabase/migrations/202608120001_initial_schema.sql`。

## 部署

将仓库导入 Vercel，并在项目环境变量中配置 `.env.example` 中的变量。构建命令使用 `npm run build`。
