import { protectPage } from "@/lib/auth/page-access";

export default async function AiAcquisitionLayout({ children }: { children: React.ReactNode }) {
  await protectPage("ai.acquisition.view");
  return children;
}
