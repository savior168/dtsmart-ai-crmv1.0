import { createAdminClient } from "@/lib/supabase/admin";
import { customerDeliveryMatchesForwarder, type ForwarderContact } from "@/lib/orders/pi-delivery-match";

export async function assertPiDeliveryClassification(customerId: string, body: Record<string, unknown>) {
  const customerAddress = String(body.delivery_address || "").trim();
  if (!customerAddress) return;
  const customer = await createAdminClient().from("customers")
    .select("forwarder_addresses,forwarder_contact_entries").eq("id", customerId).maybeSingle();
  if (customer.error) throw customer.error;
  if (customerDeliveryMatchesForwarder(customerAddress,
    customer.data?.forwarder_addresses,
    customer.data?.forwarder_contact_entries as ForwarderContact[] | null)) {
    throw new Error("客户收货地址与客户档案中的货代地址匹配；请在“货代收货信息”栏选择该地址，勿填入客户收货栏");
  }
}
