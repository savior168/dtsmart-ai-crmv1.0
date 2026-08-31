import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { TaskRuntime } from "@/components/task-runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "智客云｜AI客户分析与管理系统",
    template: "%s｜智客云",
  },
  description: "真实识别客户，精准驱动成交",
  applicationName: "智客云",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><TaskRuntime /><AppShell>{children}</AppShell></body>
    </html>
  );
}
