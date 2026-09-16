import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { TaskRuntime } from "@/components/task-runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "智客云｜AI精准获客，让销售更快成交",
    template: "%s｜智客云",
  },
  description: "从全球公开数据发现并核验目标客户，让销售减少重复搜索，更快获得可联系、可跟进、可转化的精准客户",
  applicationName: "智客云",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><TaskRuntime /><AppShell>{children}</AppShell></body>
    </html>
  );
}
