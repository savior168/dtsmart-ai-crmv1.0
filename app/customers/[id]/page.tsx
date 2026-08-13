import { CustomerCrmView } from "@/components/customer-crm-view";

export default async function CustomerCrmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerCrmView customerId={id} />;
}
