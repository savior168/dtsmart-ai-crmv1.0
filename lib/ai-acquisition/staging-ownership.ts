export function stagingCustomerBelongsToTask(
  customer: { pool_status: string | null; source_reference: string | null },
  taskId: string,
) {
  return customer.pool_status === "AI_STAGING" && customer.source_reference === taskId;
}

export function canInvalidateStagingCustomer(activeCandidateCount: number) {
  // The current candidate is still ANALYZING until its decision is saved.
  // A second ANALYZING or REVIEW candidate must retain the shared legacy row.
  return activeCandidateCount <= 1;
}
