export type ForwarderContact = { address?: string | null; recipient?: string | null; phone?: string | null };

function addressKey(value: string) {
  return value.toLocaleLowerCase().replace(/[\s，,。·\-]/g, "");
}

/** Match only a substantial known address; do not guess from a person's name. */
export function customerDeliveryMatchesForwarder(
  customerAddress: string,
  forwarderAddresses: string[] | null | undefined,
  forwarderContacts: ForwarderContact[] | null | undefined,
) {
  const candidate = addressKey(customerAddress);
  if (!candidate) return false;
  return [...(forwarderAddresses || []), ...(forwarderContacts || []).map((entry) => entry.address || "")]
    .some((address) => {
      const known = addressKey(address);
      return known.length >= 8 && candidate.includes(known);
    });
}
