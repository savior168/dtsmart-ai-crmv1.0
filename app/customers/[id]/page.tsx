import { CustomerCrmDetailView } from "@/components/customer-crm-detail-view";

export default async function CustomerCrmPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const fromPool = query.from === "pool";
  return <CustomerCrmDetailView customerId={id} returnTo={fromPool ? "/customers/pool" : "/customers"} returnLabel={fromPool ? "返回客户公海" : "返回客户列表"} />;
}
