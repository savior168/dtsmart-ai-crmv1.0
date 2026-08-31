import { protectPage } from "@/lib/auth/page-access";
export default async function AiScreeningLayout({children}:{children:React.ReactNode}){await protectPage("ai.tasks.view");return children;}
