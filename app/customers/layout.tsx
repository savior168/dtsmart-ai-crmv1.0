import { protectPage } from "@/lib/auth/page-access";
export default async function CustomersLayout({children}:{children:React.ReactNode}){await protectPage("customers.view");return children;}
