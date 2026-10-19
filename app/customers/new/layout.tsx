import { protectPage } from "@/lib/auth/page-access";

export default async function NewCustomerLayout({ children }: { children: React.ReactNode }) {
  await protectPage("customers.create");
  return children;
}
