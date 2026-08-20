export type AiTask = {
  id: string; task_number: string; name: string; strategy: "SMART" | "DEEP"; strategy_version: string;
  status: string; total_count: number; success_count: number; failed_count: number; processed_count: number; pending_count: number;
  total_tokens: number; total_cost_usd: number; created_at: string; started_at?: string | null; completed_at?: string | null;
};

export type TaskItem = {
  id: string; task_id: string; customer_id: string; status: string; progress: number; current_step: string;
  attempt_count: number; max_attempts: number; error_code?: string | null; error_message?: string | null;
  total_tokens: number; cost_usd: number; updated_at: string;
  customer?: { id: string; company_name: string; contact_name?: string | null; phone?: string | null; email?: string | null; country?: string | null; ai_score?: number | null; ai_level?: string | null } | null;
};

export type AiResult = {
  id: string; task_id: string; customer_id: string; strategy: "SMART" | "DEEP"; strategy_version: string;
  score: number; grade: string; target_decision: string; industry_type?: string | null; summary?: string | null; ai_reason?: string | null;
  business_relevance?: string | null; customer_value?: string | null; followup_suggestion?: string | null;
  confidence_score?: number | null; evidence_sufficiency?: string | null; analyzed_channels?: string[]; skipped_channels?: unknown[];
  evidence_conflicts?: string[]; early_stop_reason?: string | null; total_tokens: number; cost_usd: number; completed_at?: string | null;
  customer?: { id: string; company_name: string; contact_name?: string | null; phone?: string | null; email?: string | null; country?: string | null; website?: string | null; google_url?: string | null } | null;
  task?: { id: string; name: string; task_number: string } | null;
};

