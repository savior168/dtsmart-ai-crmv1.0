import { CustomerCrmDetailView } from "@/components/customer-crm-detail-view";

export default async function CustomerCrmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerCrmDetailView customerId={id} />;
}
