type Contact = { recipient?: string | null; phone?: string | null };
type Customer = { company_name: string; contact_name?: string | null; phone?: string | null; tax_number?: string | null; shipping_contact_entries?: Contact[] | null };
type ImportedRecipient = { delivery_company: string; delivery_recipient: string; customer_name?: string; delivery_phone: string; customer_tax_number?: string };

const normalizeText = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const normalizePhone = (value: string) => value.replace(/\D/g, "");

// Only pass customers already scoped to the PI owner. A matching name alone is
// not enough to auto-attach an imported invoice to a customer record.
export function uniqueImportedPiCustomer<T extends Customer>(customers: T[], source: ImportedRecipient): T | null {
  const recipient = normalizeText(source.delivery_recipient || source.customer_name || "");
  const phone = normalizePhone(source.delivery_phone);
  if (!recipient || !phone) return null;
  const company = normalizeText(source.delivery_company);
  const tax = normalizeText(source.customer_tax_number || "");
  const matches = customers.filter((customer) => {
    if (company && normalizeText(customer.company_name) !== company) return false;
    if (tax && normalizeText(customer.tax_number || "") !== tax) return false;
    const contacts = [{ recipient: customer.contact_name, phone: customer.phone }, ...(customer.shipping_contact_entries || [])];
    return contacts.some((contact) => normalizeText(contact.recipient || "") === recipient && normalizePhone(contact.phone || "") === phone);
  });
  return matches.length === 1 ? matches[0] : null;
}
