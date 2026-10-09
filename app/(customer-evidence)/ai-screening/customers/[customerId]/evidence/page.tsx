import { EvidenceView } from "@/components/ai-screening/evidence-view";
import { protectAnyPage } from "@/lib/auth/page-access";

export default async function AiEvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  await protectAnyPage(["customers.ai_evidence_view", "ai.results.view"]);
  const [{ customerId }, query] = await Promise.all([params, searchParams]);
  return <EvidenceView customerId={customerId} taskId={query.task} />;
}
