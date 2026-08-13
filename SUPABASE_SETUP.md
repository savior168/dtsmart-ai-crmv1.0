# Supabase 配置说明

## 1. 创建 Supabase 项目

打开 [Supabase Dashboard](https://supabase.com/dashboard)，登录后点击 **New project**，选择组织并填写项目名称、数据库密码和区域，然后等待项目创建完成。

## 2. 复制连接参数

进入新项目后，打开 **Project Settings → API**（也可以在项目的 Connect 对话框中查找），复制以下两项：

- **Project URL**：项目地址，通常以 `https://` 开头并以 `.supabase.co` 结尾。
- **anon / public key**：前端可使用的匿名访问密钥。新版界面中可能显示为 **Publishable key**。

不要把 `service_role` 或 Secret key 放入前端环境变量，也不要发送这类私密密钥。

## 3. 填写本地环境变量

复制项目根目录的 `.env.local.example` 并命名为 `.env.local`，然后填写：

```env
NEXT_PUBLIC_SUPABASE_URL=粘贴 Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=粘贴 anon/public key 或 Publishable key
```

保存后重新启动开发服务，再访问 `/supabase-test` 检查连接状态。

部署到 Vercel 时，请在 Vercel 项目的 **Settings → Environment Variables** 中添加同名的两个变量。
