# 首位管理员初始化

数据库 migration 执行后，在本机 `.env.local` 追加以下变量：

```env
SUPABASE_SERVICE_ROLE_KEY=Supabase 项目的 service_role key
ADMIN_NAME=管理员姓名
ADMIN_EMAIL=管理员邮箱
ADMIN_PASSWORD=至少 8 位强密码
```

然后运行：

```bash
npm run admin:create
```

脚本使用服务端密钥创建已确认邮箱的 Supabase Auth 用户，并以相同 UUID 写入 `public.users`，角色固定为 `ADMIN`。如果档案写入失败，脚本会删除刚创建的 Auth 用户进行回滚。

`SUPABASE_SERVICE_ROLE_KEY` 只能保存在本机或服务器环境变量中，禁止提交 Git 或暴露给浏览器。
