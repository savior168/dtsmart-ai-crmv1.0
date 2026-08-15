import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { TaskRuntime } from "@/components/task-runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: "DTSmart TradeOS",
  description: "精准识客&高效转化",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><TaskRuntime /><AppShell>{children}</AppShell></body>
    </html>
  );
}
