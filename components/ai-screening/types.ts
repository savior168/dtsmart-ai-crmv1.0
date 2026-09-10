export type AiTask = {
  id: string; task_number: string; name: string; strategy: "SMART" | "DEEP"; strategy_version: string;
  cost_mode?: "ADAPTIVE" | "FREE_ONLY"; task_cost_limit_usd?: number | null;
  user_id?: string; owner?: { id: string; name?: string | null; email?: string | null } | null;
  status: string; total_count: number; success_count: number; review_count?: number; failed_count: number; processed_count: number; pending_count: number;
  total_tokens: number; total_cost_usd: number; created_at: string; updated_at?: string | null;
  started_at?: string | null; completed_at?: string | null; finished_at?: string | null; elapsed_ms?: number | null;
  workflow_run_id?: string | null;
  google_places_call_count?: number;
  openai_cost_usd?: number;
  google_places_cost_usd?: number;
  third_party_cost_usd?: number;
  google_places_sku_breakdown?: Record<string, { count: number; amount_usd: number }>;
  paid_api_budget_blocks?: Record<string, number>;
};

export type TaskItem = {
  id: string; task_id: string; customer_id: string; status: string; progress: number; current_step: string;
  attempt_count: number; max_attempts: number; error_code?: string | null; error_message?: string | null;
  pipeline_stage?: string | null; result_id?: string | null; error_context?: Record<string, unknown> | null;
  total_tokens: number; cost_usd: number; updated_at: string;
  google_places_call_count?: number;
  google_places_sku_breakdown?: Record<string, { count: number; amount_usd: number }>;
  result?: { id: string; score?: number | null; grade?: string | null; target_decision?: string | null; industry_type?: string | null } | null;
  customer?: { id: string; company_name: string; contact_name?: string | null; phone?: string | null; email?: string | null; country?: string | null; industry?: string | null; is_target_customer?: boolean | null; ai_score?: number | null; ai_level?: string | null } | null;
};

export type AiResult = {
  id: string; task_id: string; customer_id: string; strategy: "SMART" | "DEEP"; strategy_version: string;
  score: number | null; grade: string | null; target_decision: string; industry_type?: string | null; summary?: string | null; ai_reason?: string | null;
  decision_status?: string | null; business_scope?: string | null; company_scale?: string | null; company_scale_evidence?: string | null;
  business_relevance?: string | null; customer_value?: string | null; followup_suggestion?: string | null;
  confidence_score?: number | null; evidence_sufficiency?: string | null; analyzed_channels?: string[]; skipped_channels?: unknown[];
  evidence_conflicts?: string[]; early_stop_reason?: string | null; total_tokens: number; cost_usd: number; completed_at?: string | null;
  score_breakdown?: Record<string, number>; suggested_contact_order?: string[]; discovered_contacts?: { website_email?: string | null; website_phone?: string | null; whatsapp?: string[]; contacts?: Array<{ type?: string; valueRaw?: string; valueNormalized?: string; verificationStatus?: string; sourceChannel?: string; sourceUrl?: string }> };
  manual_review_status?: string; manual_review_note?: string | null; model_version?: string | null; rule_version?: string | null; field_mapping_version?: string | null;
  automation_status?: "AUTO_DEVELOP"|"AUTO_REJECT"|"AUTO_HOLD"|"ANALYSIS_FAILED";
  primary_industry?: string|null; identity_status?: string|null; identity_confidence?:number|null; industry_confidence?:number|null; decision_confidence?:number|null;
  preferred_contact_type?:string|null; preferred_contact_value?:string|null; preferred_contact_source_url?:string|null; preferred_contact_reason?:string|null; preferred_contact_confidence?:number|null;
  customer?: { id: string; company_name: string; contact_name?: string | null; phone?: string | null; email?: string | null; country?: string | null; website?: string | null; google_url?: string | null } | null;
  task?: { id: string; name: string; task_number: string; user_id?: string } | null;
  owner?: { id: string; name?: string | null; email?: string | null } | null;
};

