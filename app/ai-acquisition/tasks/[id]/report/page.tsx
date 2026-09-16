import { AcquisitionTaskReport } from "@/components/ai-acquisition/task-report";

export default async function AcquisitionTaskReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AcquisitionTaskReport taskId={id} />;
}
