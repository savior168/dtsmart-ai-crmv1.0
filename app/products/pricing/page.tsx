import { SalesPricingSettingsView } from "@/components/sales-pricing-settings-view";
import { protectPage } from "@/lib/auth/page-access";

export default async function SalesPricingSettingsPage(){await protectPage("pricebooks.rules.view");return <SalesPricingSettingsView/>}
