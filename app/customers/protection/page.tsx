import { redirect } from "next/navigation";

export default function ProtectionPage() {
  redirect("/customers?tab=protection");
}
