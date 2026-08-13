# DTSmart AI获客CRM 数据库初始化说明

本项目改用 Supabase SQL Editor 初始化数据库，不依赖 `supabase link` 或 `supabase db push`。

## 目标项目

- Project ref：`yxmlraedjxqelyxelngg`
- Project URL：`https://yxmlraedjxqelyxelngg.supabase.co`

执行前确认 Supabase Dashboard 当前打开的是上述项目。

## 执行顺序

### 1. 执行正式数据库 SQL

1. 在 Supabase Dashboard 左侧打开 **SQL Editor**。
2. 点击 **New query**。
3. 打开项目文件：

   ```text
   supabase/migrations/202608120002_crm_schema_and_rls.sql
   ```

4. 复制该文件中的全部 SQL，粘贴到 SQL Editor。
5. 点击 **Run**，等待出现成功结果。

不要执行 `202608120001_initial_schema.sql`，它是早期演示 migration，会创建不属于正式结构的 `leads` 表。

正式 SQL 会依次创建扩展、8 张表、外键、索引、时间更新触发器、Auth 用户同步触发器和 RLS 策略。该 SQL 已支持失败后重新完整执行。

### 2. 验证 8 张表

在 SQL Editor 新建查询并执行：

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'users',
    'departments',
    'customers',
    'customer_claims',
    'customer_protection',
    'followups',
    'import_tasks',
    'audit_logs'
  )
order by table_name;
```

必须返回以下 8 行：

```text
audit_logs
customer_claims
customer_protection
customers
departments
followups
import_tasks
users
```

### 3. 验证 RLS

执行：

```sql
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'users',
    'departments',
    'customers',
    'customer_claims',
    'customer_protection',
    'followups',
    'import_tasks',
    'audit_logs'
  )
order by relname;
```

必须返回 8 行，并且每一行的 `rls_enabled` 都是 `true`。

如需检查策略数量，可执行：

```sql
select tablename, count(*) as policy_count
from pg_policies
where schemaname = 'public'
  and tablename in (
    'users', 'departments', 'customers', 'customer_claims',
    'customer_protection', 'followups', 'import_tasks', 'audit_logs'
  )
group by tablename
order by tablename;
```

### 4. 配置应用环境变量

`.env.local` 中保留：

```env
NEXT_PUBLIC_SUPABASE_URL=https://yxmlraedjxqelyxelngg.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=项目的 anon/public 或 Publishable key
```

Vercel 中也需要配置这两个同名变量。

### 5. 初始化第一个 ADMIN

从 Supabase 项目的 **Project Settings → API** 获取 `service_role` key。只在本机 `.env.local` 中添加：

```env
SUPABASE_SERVICE_ROLE_KEY=项目的 service_role key
ADMIN_NAME=管理员姓名
ADMIN_EMAIL=管理员邮箱
ADMIN_PASSWORD=至少 8 位的强密码
```

然后在项目目录执行：

```bash
npm run admin:create
```

成功后，脚本会同时创建：

- Supabase Auth 用户
- 使用相同 UUID 关联的 `public.users` 记录
- `role = ADMIN`
- `status = ACTIVE`

验证 ADMIN 档案：

```sql
select id, name, email, role, status, created_at
from public.users
where role = 'ADMIN';
```

`SUPABASE_SERVICE_ROLE_KEY` 禁止提交到 Git、发送到聊天或暴露给浏览器。管理员初始化完成后可从本地 `.env.local` 移除。
