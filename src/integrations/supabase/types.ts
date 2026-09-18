export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_activity_log: {
        Row: {
          action_type: string
          admin_email: string
          admin_user_id: string
          created_at: string
          delivery_status: string | null
          email_sent: boolean | null
          emails_failed_count: number | null
          emails_sent_count: number | null
          error_message: string | null
          id: string
          inapp_sent: number | null
          jurisdiction_id: string | null
          jurisdiction_name: string | null
          notification_message: string | null
          notification_title: string | null
          subscriber_count: number | null
        }
        Insert: {
          action_type: string
          admin_email: string
          admin_user_id: string
          created_at?: string
          delivery_status?: string | null
          email_sent?: boolean | null
          emails_failed_count?: number | null
          emails_sent_count?: number | null
          error_message?: string | null
          id?: string
          inapp_sent?: number | null
          jurisdiction_id?: string | null
          jurisdiction_name?: string | null
          notification_message?: string | null
          notification_title?: string | null
          subscriber_count?: number | null
        }
        Update: {
          action_type?: string
          admin_email?: string
          admin_user_id?: string
          created_at?: string
          delivery_status?: string | null
          email_sent?: boolean | null
          emails_failed_count?: number | null
          emails_sent_count?: number | null
          error_message?: string | null
          id?: string
          inapp_sent?: number | null
          jurisdiction_id?: string | null
          jurisdiction_name?: string | null
          notification_message?: string | null
          notification_title?: string | null
          subscriber_count?: number | null
        }
        Relationships: []
      }
      agent_runs: {
        Row: {
          agent_name: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          filing_id: string
          id: string
          input_data: Json | null
          layer: number
          output_data: Json | null
          started_at: string | null
          status: string
        }
        Insert: {
          agent_name: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          filing_id: string
          id?: string
          input_data?: Json | null
          layer: number
          output_data?: Json | null
          started_at?: string | null
          status?: string
        }
        Update: {
          agent_name?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          filing_id?: string
          id?: string
          input_data?: Json | null
          layer?: number
          output_data?: Json | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "permit_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      architecture_replication_comments: {
        Row: {
          comment_text: string
          comment_type: string
          created_at: string
          created_by: string | null
          id: string
          matrix_row_id: string
        }
        Insert: {
          comment_text: string
          comment_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          matrix_row_id: string
        }
        Update: {
          comment_text?: string
          comment_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          matrix_row_id?: string
        }
        Relationships: []
      }
      architecture_replication_items: {
        Row: {
          assigned_owner: string | null
          blocker_description: string | null
          client_approved_at: string | null
          client_feedback: string | null
          completion_checks: Json
          created_at: string
          id: string
          implementation_commit: string | null
          implementation_status: string
          is_blocked: boolean
          last_tested_at: string | null
          matrix_row_id: string
          preview_url: string | null
          test_evidence: string | null
          updated_at: string
          updated_by: string | null
          verification_status: string
        }
        Insert: {
          assigned_owner?: string | null
          blocker_description?: string | null
          client_approved_at?: string | null
          client_feedback?: string | null
          completion_checks?: Json
          created_at?: string
          id?: string
          implementation_commit?: string | null
          implementation_status?: string
          is_blocked?: boolean
          last_tested_at?: string | null
          matrix_row_id: string
          preview_url?: string | null
          test_evidence?: string | null
          updated_at?: string
          updated_by?: string | null
          verification_status?: string
        }
        Update: {
          assigned_owner?: string | null
          blocker_description?: string | null
          client_approved_at?: string | null
          client_feedback?: string | null
          completion_checks?: Json
          created_at?: string
          id?: string
          implementation_commit?: string | null
          implementation_status?: string
          is_blocked?: boolean
          last_tested_at?: string | null
          matrix_row_id?: string
          preview_url?: string | null
          test_evidence?: string | null
          updated_at?: string
          updated_by?: string | null
          verification_status?: string
        }
        Relationships: []
      }
      audit_trail: {
        Row: {
          action_type: string
          actor_id: string
          created_at: string
          id: string
          input_hash: string | null
          project_id: string
          routing_decision: string | null
        }
        Insert: {
          action_type: string
          actor_id: string
          created_at?: string
          id?: string
          input_hash?: string | null
          project_id: string
          routing_decision?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string
          created_at?: string
          id?: string
          input_hash?: string | null
          project_id?: string
          routing_decision?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_trail_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_trail_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      baseline_actions: {
        Row: {
          action_type: string
          comment_id: string | null
          created_at: string
          duration_minutes: number
          expeditor_id: string
          id: string
          project_id: string
        }
        Insert: {
          action_type: string
          comment_id?: string | null
          created_at?: string
          duration_minutes?: number
          expeditor_id: string
          id?: string
          project_id: string
        }
        Update: {
          action_type?: string
          comment_id?: string | null
          created_at?: string
          duration_minutes?: number
          expeditor_id?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "baseline_actions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "parsed_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_actions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_actions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      code_analyzer_runs: {
        Row: {
          analysis_instructions: string | null
          analysis_mode: string | null
          analysis_type: string
          code_year: string | null
          completed_at: string | null
          created_at: string
          form_document_id: string | null
          id: string
          index_completeness: Json | null
          jurisdiction: string | null
          project_id: string
          project_type: string | null
          source_fingerprint: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_instructions?: string | null
          analysis_mode?: string | null
          analysis_type?: string
          code_year?: string | null
          completed_at?: string | null
          created_at?: string
          form_document_id?: string | null
          id?: string
          index_completeness?: Json | null
          jurisdiction?: string | null
          project_id: string
          project_type?: string | null
          source_fingerprint?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_instructions?: string | null
          analysis_mode?: string | null
          analysis_type?: string
          code_year?: string | null
          completed_at?: string | null
          created_at?: string
          form_document_id?: string | null
          id?: string
          index_completeness?: Json | null
          jurisdiction?: string | null
          project_id?: string
          project_type?: string | null
          source_fingerprint?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_analyzer_runs_form_document_id_fkey"
            columns: ["form_document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_analyzer_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_analyzer_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      code_analyzer_sheets: {
        Row: {
          created_at: string
          discipline: string
          excluded: boolean
          file_name: string | null
          id: string
          image_document_id: string | null
          page_number: number
          project_id: string
          sheet_label: string | null
          source_document_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discipline?: string
          excluded?: boolean
          file_name?: string | null
          id?: string
          image_document_id?: string | null
          page_number?: number
          project_id: string
          sheet_label?: string | null
          source_document_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discipline?: string
          excluded?: boolean
          file_name?: string | null
          id?: string
          image_document_id?: string | null
          page_number?: number
          project_id?: string
          sheet_label?: string | null
          source_document_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_analyzer_sheets_image_document_id_fkey"
            columns: ["image_document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_analyzer_sheets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_analyzer_sheets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_analyzer_sheets_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      code_modification_review_documents: {
        Row: {
          created_at: string
          document_id: string
          id: string
          review_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          review_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          review_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "code_modification_review_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_modification_review_documents_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "code_modification_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      code_modification_reviews: {
        Row: {
          created_at: string
          evidence: Json
          extracted_request: Json
          extraction_warnings: Json
          form_document_id: string
          form_fingerprint: string
          id: string
          overall_status: string
          project_id: string
          run_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          evidence?: Json
          extracted_request?: Json
          extraction_warnings?: Json
          form_document_id: string
          form_fingerprint?: string
          id?: string
          overall_status?: string
          project_id: string
          run_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          evidence?: Json
          extracted_request?: Json
          extraction_warnings?: Json
          form_document_id?: string
          form_fingerprint?: string
          id?: string
          overall_status?: string
          project_id?: string
          run_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_modification_reviews_form_document_id_fkey"
            columns: ["form_document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_modification_reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_modification_reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_modification_reviews_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "code_analyzer_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_quality_checks: {
        Row: {
          avg_score: number | null
          created_at: string
          created_by: string | null
          flagged_count: number
          id: string
          project_id: string
          results: Json
        }
        Insert: {
          avg_score?: number | null
          created_at?: string
          created_by?: string | null
          flagged_count?: number
          id?: string
          project_id: string
          results?: Json
        }
        Update: {
          avg_score?: number | null
          created_at?: string
          created_by?: string | null
          flagged_count?: number
          id?: string
          project_id?: string
          results?: Json
        }
        Relationships: [
          {
            foreignKeyName: "comment_quality_checks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_quality_checks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      coordination_applications: {
        Row: {
          action_required: boolean
          agent_draft_metadata: Json
          application_type: string | null
          coordination_record_id: string
          created_at: string
          draft_status: string
          email_bounced_at: string | null
          external_application_id: string | null
          external_job_id: string | null
          graph_internet_message_id: string | null
          graph_message_id: string | null
          id: string
          idempotency_key: string | null
          last_error: string | null
          last_synced_at: string | null
          load_summary: Json
          metadata: Json
          package_documents: Json
          portal_last_updated_at: string | null
          portal_milestone: string | null
          portal_status: string | null
          portal_submitted_at: string | null
          project_id: string
          provider_slug: string | null
          record_source: string
          reviewed_at: string | null
          reviewed_by: string | null
          submission_method: string | null
          submitted_at: string | null
          submitted_by: string | null
          tenant_id: string | null
          updated_at: string
          utility_ticket_number: string | null
        }
        Insert: {
          action_required?: boolean
          agent_draft_metadata?: Json
          application_type?: string | null
          coordination_record_id: string
          created_at?: string
          draft_status?: string
          email_bounced_at?: string | null
          external_application_id?: string | null
          external_job_id?: string | null
          graph_internet_message_id?: string | null
          graph_message_id?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          load_summary?: Json
          metadata?: Json
          package_documents?: Json
          portal_last_updated_at?: string | null
          portal_milestone?: string | null
          portal_status?: string | null
          portal_submitted_at?: string | null
          project_id: string
          provider_slug?: string | null
          record_source?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          submission_method?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          tenant_id?: string | null
          updated_at?: string
          utility_ticket_number?: string | null
        }
        Update: {
          action_required?: boolean
          agent_draft_metadata?: Json
          application_type?: string | null
          coordination_record_id?: string
          created_at?: string
          draft_status?: string
          email_bounced_at?: string | null
          external_application_id?: string | null
          external_job_id?: string | null
          graph_internet_message_id?: string | null
          graph_message_id?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          load_summary?: Json
          metadata?: Json
          package_documents?: Json
          portal_last_updated_at?: string | null
          portal_milestone?: string | null
          portal_status?: string | null
          portal_submitted_at?: string | null
          project_id?: string
          provider_slug?: string | null
          record_source?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          submission_method?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          tenant_id?: string | null
          updated_at?: string
          utility_ticket_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coordination_applications_record_fkey"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      coordination_communications: {
        Row: {
          agent_processed_metadata: Json
          channel: string | null
          classification: string | null
          classification_confidence: number | null
          coordination_record_id: string
          created_at: string
          direction: string | null
          external_application_id: string | null
          external_message_id: string | null
          id: string
          idempotency_key: string | null
          message_timestamp: string | null
          needs_human_attention: boolean
          parsed_action_items: Json
          parsed_summary: string | null
          project_id: string
          provider_slug: string | null
          raw_attachments: Json
          raw_body: string | null
          raw_subject: string | null
          recipient: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sender: string | null
          tenant_id: string | null
          thread_id: string | null
          updated_at: string
        }
        Insert: {
          agent_processed_metadata?: Json
          channel?: string | null
          classification?: string | null
          classification_confidence?: number | null
          coordination_record_id: string
          created_at?: string
          direction?: string | null
          external_application_id?: string | null
          external_message_id?: string | null
          id?: string
          idempotency_key?: string | null
          message_timestamp?: string | null
          needs_human_attention?: boolean
          parsed_action_items?: Json
          parsed_summary?: string | null
          project_id: string
          provider_slug?: string | null
          raw_attachments?: Json
          raw_body?: string | null
          raw_subject?: string | null
          recipient?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender?: string | null
          tenant_id?: string | null
          thread_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_processed_metadata?: Json
          channel?: string | null
          classification?: string | null
          classification_confidence?: number | null
          coordination_record_id?: string
          created_at?: string
          direction?: string | null
          external_application_id?: string | null
          external_message_id?: string | null
          id?: string
          idempotency_key?: string | null
          message_timestamp?: string | null
          needs_human_attention?: boolean
          parsed_action_items?: Json
          parsed_summary?: string | null
          project_id?: string
          provider_slug?: string | null
          raw_attachments?: Json
          raw_body?: string | null
          raw_subject?: string | null
          recipient?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender?: string | null
          tenant_id?: string | null
          thread_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coordination_communications_record_fkey"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      coordination_cos_design_records: {
        Row: {
          accepted_deviations: Json
          accepted_fields: Json
          agent_metadata: Json
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          approved_snapshot: Json | null
          attention_reasons: Json
          baseline_fields: Json
          comparison_rows: Json
          coordination_record_id: string
          created_at: string
          discrepancy_report: Json
          document_refs: Json
          evidence_status: string
          extracted_fields: Json
          field_overrides: Json
          id: string
          is_current: boolean
          needs_human_attention: boolean
          parse_meta: Json
          project_id: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          review_status: string
          review_version: number
          revision_request: Json | null
          source_communication_id: string | null
          source_text_excerpt: string | null
          superseded_by: string | null
          updated_at: string
          utility_evidence_issued_at: string | null
          version: number
        }
        Insert: {
          accepted_deviations?: Json
          accepted_fields?: Json
          agent_metadata?: Json
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_snapshot?: Json | null
          attention_reasons?: Json
          baseline_fields?: Json
          comparison_rows?: Json
          coordination_record_id: string
          created_at?: string
          discrepancy_report?: Json
          document_refs?: Json
          evidence_status?: string
          extracted_fields?: Json
          field_overrides?: Json
          id?: string
          is_current?: boolean
          needs_human_attention?: boolean
          parse_meta?: Json
          project_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          review_status?: string
          review_version?: number
          revision_request?: Json | null
          source_communication_id?: string | null
          source_text_excerpt?: string | null
          superseded_by?: string | null
          updated_at?: string
          utility_evidence_issued_at?: string | null
          version?: number
        }
        Update: {
          accepted_deviations?: Json
          accepted_fields?: Json
          agent_metadata?: Json
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_snapshot?: Json | null
          attention_reasons?: Json
          baseline_fields?: Json
          comparison_rows?: Json
          coordination_record_id?: string
          created_at?: string
          discrepancy_report?: Json
          document_refs?: Json
          evidence_status?: string
          extracted_fields?: Json
          field_overrides?: Json
          id?: string
          is_current?: boolean
          needs_human_attention?: boolean
          parse_meta?: Json
          project_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          review_status?: string
          review_version?: number
          revision_request?: Json | null
          source_communication_id?: string | null
          source_text_excerpt?: string | null
          superseded_by?: string | null
          updated_at?: string
          utility_evidence_issued_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "coordination_cos_design_records_record_fkey"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      coordination_costs: {
        Row: {
          actual_amount: number | null
          actual_received_at: string | null
          actual_source: string | null
          billing_hold: boolean
          client_approval_status: string
          client_approved_at: string | null
          client_approved_by: string | null
          client_billed_at: string | null
          coordination_record_id: string
          cos_design_record_id: string | null
          cost_type: string | null
          created_at: string
          estimated_amount: number | null
          estimated_at: string | null
          estimated_source: string | null
          human_override_bill_at: string | null
          id: string
          idempotency_key: string | null
          invoice_received_doc_ref: string | null
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          project_id: string
          qb_attempt_count: number
          qb_last_error: string | null
          qb_sync_status: string
          quickbooks_invoice_id: string | null
          tenant_id: string | null
          updated_at: string
          variance_pct: number | null
        }
        Insert: {
          actual_amount?: number | null
          actual_received_at?: string | null
          actual_source?: string | null
          billing_hold?: boolean
          client_approval_status?: string
          client_approved_at?: string | null
          client_approved_by?: string | null
          client_billed_at?: string | null
          coordination_record_id: string
          cos_design_record_id?: string | null
          cost_type?: string | null
          created_at?: string
          estimated_amount?: number | null
          estimated_at?: string | null
          estimated_source?: string | null
          human_override_bill_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_received_doc_ref?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          project_id: string
          qb_attempt_count?: number
          qb_last_error?: string | null
          qb_sync_status?: string
          quickbooks_invoice_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          variance_pct?: number | null
        }
        Update: {
          actual_amount?: number | null
          actual_received_at?: string | null
          actual_source?: string | null
          billing_hold?: boolean
          client_approval_status?: string
          client_approved_at?: string | null
          client_approved_by?: string | null
          client_billed_at?: string | null
          coordination_record_id?: string
          cos_design_record_id?: string | null
          cost_type?: string | null
          created_at?: string
          estimated_amount?: number | null
          estimated_at?: string | null
          estimated_source?: string | null
          human_override_bill_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_received_doc_ref?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          project_id?: string
          qb_attempt_count?: number
          qb_last_error?: string | null
          qb_sync_status?: string
          quickbooks_invoice_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          variance_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coordination_costs_cos_design_record_id_fkey"
            columns: ["cos_design_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_cos_design_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coordination_costs_record_fkey"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "coordination_costs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      coordination_equipment: {
        Row: {
          check_in_method: string | null
          coordination_record_id: string
          created_at: string
          current_eta: string | null
          equipment_size: string | null
          equipment_type: string | null
          eta_history: Json
          id: string
          initial_eta: string | null
          last_check_in_at: string | null
          last_response_at: string | null
          last_weeks_of_slip: number | null
          next_check_in_at: string | null
          project_id: string
          status: string
          tenant_id: string | null
          updated_at: string
          weeks_of_slip: number | null
        }
        Insert: {
          check_in_method?: string | null
          coordination_record_id: string
          created_at?: string
          current_eta?: string | null
          equipment_size?: string | null
          equipment_type?: string | null
          eta_history?: Json
          id?: string
          initial_eta?: string | null
          last_check_in_at?: string | null
          last_response_at?: string | null
          last_weeks_of_slip?: number | null
          next_check_in_at?: string | null
          project_id: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
          weeks_of_slip?: number | null
        }
        Update: {
          check_in_method?: string | null
          coordination_record_id?: string
          created_at?: string
          current_eta?: string | null
          equipment_size?: string | null
          equipment_type?: string | null
          eta_history?: Json
          id?: string
          initial_eta?: string | null
          last_check_in_at?: string | null
          last_response_at?: string | null
          last_weeks_of_slip?: number | null
          next_check_in_at?: string | null
          project_id?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
          weeks_of_slip?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coordination_equipment_record_fkey"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "coordination_equipment_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      coordination_milestones: {
        Row: {
          actual_date: string | null
          coordination_record_id: string
          created_at: string
          external_application_id: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          milestone_type: string | null
          notes: string | null
          occurred_at: string | null
          parent_stage: number | null
          portal_milestone: string | null
          portal_status: string | null
          project_id: string
          provider_slug: string | null
          source: string | null
          status: string
          target_date: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          actual_date?: string | null
          coordination_record_id: string
          created_at?: string
          external_application_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          milestone_type?: string | null
          notes?: string | null
          occurred_at?: string | null
          parent_stage?: number | null
          portal_milestone?: string | null
          portal_status?: string | null
          project_id: string
          provider_slug?: string | null
          source?: string | null
          status?: string
          target_date?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          actual_date?: string | null
          coordination_record_id?: string
          created_at?: string
          external_application_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          milestone_type?: string | null
          notes?: string | null
          occurred_at?: string | null
          parent_stage?: number | null
          portal_milestone?: string | null
          portal_status?: string | null
          project_id?: string
          provider_slug?: string | null
          source?: string | null
          status?: string
          target_date?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coordination_milestones_record_fkey"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      coordination_records: {
        Row: {
          ack_sla_due_at: string | null
          ack_sla_escalated_at: string | null
          ack_sla_started_at: string | null
          ack_sla_stopped_at: string | null
          acknowledgment_received_at: string | null
          agent_monitored: boolean
          application_submitted_at: string | null
          class_of_service_issued_at: string | null
          closeout_package_doc_id: string | null
          cos_sla_due_at: string | null
          cos_sla_escalated_at: string | null
          cos_sla_started_at: string | null
          cos_sla_stopped_at: string | null
          created_at: string
          current_stage: number
          current_stage_entered_at: string | null
          current_stage_state: string
          energization_actual_date: string | null
          energization_date_conflict: boolean
          energization_target_date: string | null
          id: string
          inspection_release_received_at: string | null
          last_error: string | null
          metadata: Json
          meter_set_scheduled_at: string | null
          next_required_action: string | null
          predicted_p50_computed_at: string | null
          predicted_p50_date: string | null
          predicted_p50_previous: string | null
          predicted_p90_date: string | null
          prediction_baseline_source: string | null
          prediction_reason: Json
          prediction_sample_size: number | null
          project_id: string
          scope_description: string
          site_contact_email: string | null
          site_contact_name: string | null
          site_contact_phone: string | null
          site_readiness_confirmed_at: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string | null
          utility_account_number: string | null
          utility_contact_email: string | null
          utility_contact_name: string | null
          utility_contact_phone: string | null
          utility_project_manager: string | null
          utility_provider_id: string | null
          utility_type: string | null
        }
        Insert: {
          ack_sla_due_at?: string | null
          ack_sla_escalated_at?: string | null
          ack_sla_started_at?: string | null
          ack_sla_stopped_at?: string | null
          acknowledgment_received_at?: string | null
          agent_monitored?: boolean
          application_submitted_at?: string | null
          class_of_service_issued_at?: string | null
          closeout_package_doc_id?: string | null
          cos_sla_due_at?: string | null
          cos_sla_escalated_at?: string | null
          cos_sla_started_at?: string | null
          cos_sla_stopped_at?: string | null
          created_at?: string
          current_stage?: number
          current_stage_entered_at?: string | null
          current_stage_state?: string
          energization_actual_date?: string | null
          energization_date_conflict?: boolean
          energization_target_date?: string | null
          id?: string
          inspection_release_received_at?: string | null
          last_error?: string | null
          metadata?: Json
          meter_set_scheduled_at?: string | null
          next_required_action?: string | null
          predicted_p50_computed_at?: string | null
          predicted_p50_date?: string | null
          predicted_p50_previous?: string | null
          predicted_p90_date?: string | null
          prediction_baseline_source?: string | null
          prediction_reason?: Json
          prediction_sample_size?: number | null
          project_id: string
          scope_description?: string
          site_contact_email?: string | null
          site_contact_name?: string | null
          site_contact_phone?: string | null
          site_readiness_confirmed_at?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
          utility_account_number?: string | null
          utility_contact_email?: string | null
          utility_contact_name?: string | null
          utility_contact_phone?: string | null
          utility_project_manager?: string | null
          utility_provider_id?: string | null
          utility_type?: string | null
        }
        Update: {
          ack_sla_due_at?: string | null
          ack_sla_escalated_at?: string | null
          ack_sla_started_at?: string | null
          ack_sla_stopped_at?: string | null
          acknowledgment_received_at?: string | null
          agent_monitored?: boolean
          application_submitted_at?: string | null
          class_of_service_issued_at?: string | null
          closeout_package_doc_id?: string | null
          cos_sla_due_at?: string | null
          cos_sla_escalated_at?: string | null
          cos_sla_started_at?: string | null
          cos_sla_stopped_at?: string | null
          created_at?: string
          current_stage?: number
          current_stage_entered_at?: string | null
          current_stage_state?: string
          energization_actual_date?: string | null
          energization_date_conflict?: boolean
          energization_target_date?: string | null
          id?: string
          inspection_release_received_at?: string | null
          last_error?: string | null
          metadata?: Json
          meter_set_scheduled_at?: string | null
          next_required_action?: string | null
          predicted_p50_computed_at?: string | null
          predicted_p50_date?: string | null
          predicted_p50_previous?: string | null
          predicted_p90_date?: string | null
          prediction_baseline_source?: string | null
          prediction_reason?: Json
          prediction_sample_size?: number | null
          project_id?: string
          scope_description?: string
          site_contact_email?: string | null
          site_contact_name?: string | null
          site_contact_phone?: string | null
          site_readiness_confirmed_at?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
          utility_account_number?: string | null
          utility_contact_email?: string | null
          utility_contact_name?: string | null
          utility_contact_phone?: string | null
          utility_project_manager?: string | null
          utility_provider_id?: string | null
          utility_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coordination_records_closeout_package_doc_id_fkey"
            columns: ["closeout_package_doc_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coordination_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coordination_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coordination_records_utility_provider_id_fkey"
            columns: ["utility_provider_id"]
            isOneToOne: false
            referencedRelation: "utility_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      coordination_stage_transitions: {
        Row: {
          coordination_record_id: string
          created_at: string
          from_stage: number | null
          from_state: string | null
          id: string
          metadata: Json
          project_id: string
          reason: string | null
          tenant_id: string | null
          to_stage: number
          to_state: string
          triggered_by_id: string | null
          triggered_by_type: string | null
        }
        Insert: {
          coordination_record_id: string
          created_at?: string
          from_stage?: number | null
          from_state?: string | null
          id?: string
          metadata?: Json
          project_id: string
          reason?: string | null
          tenant_id?: string | null
          to_stage: number
          to_state: string
          triggered_by_id?: string | null
          triggered_by_type?: string | null
        }
        Update: {
          coordination_record_id?: string
          created_at?: string
          from_stage?: number | null
          from_state?: string | null
          id?: string
          metadata?: Json
          project_id?: string
          reason?: string | null
          tenant_id?: string | null
          to_stage?: number
          to_state?: string
          triggered_by_id?: string | null
          triggered_by_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coordination_stage_transitions_record_fkey"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "coordination_stage_transitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_requests: {
        Row: {
          city: string | null
          company_name: string | null
          county: string | null
          created_at: string
          email: string
          estimated_permits_per_year: number | null
          id: string
          jurisdiction_name: string
          notes: string | null
          project_type: string | null
          state: string
          status: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          company_name?: string | null
          county?: string | null
          created_at?: string
          email: string
          estimated_permits_per_year?: number | null
          id?: string
          jurisdiction_name: string
          notes?: string | null
          project_type?: string | null
          state: string
          status?: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          company_name?: string | null
          county?: string | null
          created_at?: string
          email?: string
          estimated_permits_per_year?: number | null
          id?: string
          jurisdiction_name?: string
          notes?: string | null
          project_type?: string | null
          state?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_annotations: {
        Row: {
          analysis_run_id: string | null
          annotation_type: string
          color: string | null
          created_at: string
          data: Json
          document_id: string | null
          id: string
          layer_order: number | null
          project_id: string
          stroke_width: number | null
          updated_at: string
          user_id: string
          visible: boolean | null
        }
        Insert: {
          analysis_run_id?: string | null
          annotation_type: string
          color?: string | null
          created_at?: string
          data?: Json
          document_id?: string | null
          id?: string
          layer_order?: number | null
          project_id: string
          stroke_width?: number | null
          updated_at?: string
          user_id: string
          visible?: boolean | null
        }
        Update: {
          analysis_run_id?: string | null
          annotation_type?: string
          color?: string | null
          created_at?: string
          data?: Json
          document_id?: string | null
          id?: string
          layer_order?: number | null
          project_id?: string
          stroke_width?: number | null
          updated_at?: string
          user_id?: string
          visible?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "document_annotations_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "code_analyzer_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_annotations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_annotations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_annotations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      document_comments: {
        Row: {
          content: string
          created_at: string
          document_id: string | null
          id: string
          mentions: string[] | null
          parent_comment_id: string | null
          position_x: number | null
          position_y: number | null
          project_id: string
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          document_id?: string | null
          id?: string
          mentions?: string[] | null
          parent_comment_id?: string | null
          position_x?: number | null
          position_y?: number | null
          project_id: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string | null
          id?: string
          mentions?: string[] | null
          parent_comment_id?: string | null
          position_x?: number | null
          position_y?: number | null
          project_id?: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_comments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "document_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      document_ingestion_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          document_id: string
          error: string | null
          failed_pages: number
          id: string
          processed_pages: number
          progress: Json
          project_id: string
          started_at: string | null
          status: string
          total_chunks: number
          total_pages: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          document_id: string
          error?: string | null
          failed_pages?: number
          id?: string
          processed_pages?: number
          progress?: Json
          project_id: string
          started_at?: string | null
          status?: string
          total_chunks?: number
          total_pages?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          document_id?: string
          error?: string | null
          failed_pages?: number
          id?: string
          processed_pages?: number
          progress?: Json
          project_id?: string
          started_at?: string | null
          status?: string
          total_chunks?: number
          total_pages?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_ingestion_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_ingestion_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_ingestion_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      email_branding_settings: {
        Row: {
          created_at: string
          footer_text: string
          header_text: string
          id: string
          logo_url: string | null
          primary_color: string
          unsubscribe_text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          footer_text?: string
          header_text?: string
          id?: string
          logo_url?: string | null
          primary_color?: string
          unsubscribe_text?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          footer_text?: string
          header_text?: string
          id?: string
          logo_url?: string | null
          primary_color?: string
          unsubscribe_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      epermit_submissions: {
        Row: {
          applicant_email: string
          applicant_name: string
          created_at: string
          environment: string
          id: string
          last_status_check: string | null
          permit_type: string
          project_id: string
          record_id: string | null
          response_data: Json | null
          status: Database["public"]["Enums"]["epermit_status"]
          status_history: Json | null
          status_message: string | null
          submitted_at: string | null
          system: Database["public"]["Enums"]["epermit_system"]
          tracking_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          applicant_email: string
          applicant_name: string
          created_at?: string
          environment?: string
          id?: string
          last_status_check?: string | null
          permit_type: string
          project_id: string
          record_id?: string | null
          response_data?: Json | null
          status?: Database["public"]["Enums"]["epermit_status"]
          status_history?: Json | null
          status_message?: string | null
          submitted_at?: string | null
          system: Database["public"]["Enums"]["epermit_system"]
          tracking_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          applicant_email?: string
          applicant_name?: string
          created_at?: string
          environment?: string
          id?: string
          last_status_check?: string | null
          permit_type?: string
          project_id?: string
          record_id?: string | null
          response_data?: Json | null
          status?: Database["public"]["Enums"]["epermit_status"]
          status_history?: Json | null
          status_message?: string | null
          submitted_at?: string | null
          system?: Database["public"]["Enums"]["epermit_system"]
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "epermit_submissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epermit_submissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flag_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          flag_key: string
          id: string
          new_value: boolean
          old_value: boolean
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          flag_key: string
          id?: string
          new_value: boolean
          old_value: boolean
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          flag_key?: string
          id?: string
          new_value?: boolean
          old_value?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "feature_flag_audit_flag_key_fkey"
            columns: ["flag_key"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["key"]
          },
        ]
      }
      feature_flags: {
        Row: {
          category: string | null
          description: string | null
          enabled: boolean
          key: string
          label: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          description?: string | null
          enabled?: boolean
          key: string
          label: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          description?: string | null
          enabled?: boolean
          key?: string
          label?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      filing_documents: {
        Row: {
          created_at: string
          document_name: string
          document_type: string
          file_format: string | null
          file_size_bytes: number | null
          file_url: string | null
          filing_id: string
          id: string
          upload_order: number | null
          validation_notes: string | null
          validation_status: string
        }
        Insert: {
          created_at?: string
          document_name: string
          document_type: string
          file_format?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          filing_id: string
          id?: string
          upload_order?: number | null
          validation_notes?: string | null
          validation_status?: string
        }
        Update: {
          created_at?: string
          document_name?: string
          document_type?: string
          file_format?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          filing_id?: string
          id?: string
          upload_order?: number | null
          validation_notes?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "filing_documents_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "permit_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      filing_professionals: {
        Row: {
          created_at: string
          filing_id: string
          id: string
          license_number: string
          license_type: string
          professional_name: string
          role_on_project: string
        }
        Insert: {
          created_at?: string
          filing_id: string
          id?: string
          license_number: string
          license_type: string
          professional_name: string
          role_on_project: string
        }
        Update: {
          created_at?: string
          filing_id?: string
          id?: string
          license_number?: string
          license_type?: string
          professional_name?: string
          role_on_project?: string
        }
        Relationships: [
          {
            foreignKeyName: "filing_professionals_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "permit_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      filing_screenshots: {
        Row: {
          agent_name: string
          created_at: string
          field_audit: Json | null
          filing_id: string
          id: string
          screenshot_url: string
          step_name: string
        }
        Insert: {
          agent_name: string
          created_at?: string
          field_audit?: Json | null
          filing_id: string
          id?: string
          screenshot_url: string
          step_name: string
        }
        Update: {
          agent_name?: string
          created_at?: string
          field_audit?: Json | null
          filing_id?: string
          id?: string
          screenshot_url?: string
          step_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "filing_screenshots_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "permit_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_config: {
        Row: {
          enforce_mode: string
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enforce_mode?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enforce_mode?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      inspection_checklist_templates: {
        Row: {
          categories: Json
          created_at: string
          description: string | null
          id: string
          inspection_type: string
          is_default: boolean | null
          name: string
          shared_at: string | null
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          categories?: Json
          created_at?: string
          description?: string | null
          id?: string
          inspection_type: string
          is_default?: boolean | null
          name: string
          shared_at?: string | null
          updated_at?: string
          user_id: string
          visibility?: string
        }
        Update: {
          categories?: Json
          created_at?: string
          description?: string | null
          id?: string
          inspection_type?: string
          is_default?: boolean | null
          name?: string
          shared_at?: string | null
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: []
      }
      inspection_photos: {
        Row: {
          caption: string | null
          checklist_item_id: string | null
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          inspection_id: string | null
          location: string | null
          project_id: string | null
          punch_list_item_id: string | null
          taken_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          checklist_item_id?: string | null
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          inspection_id?: string | null
          location?: string | null
          project_id?: string | null
          punch_list_item_id?: string | null
          taken_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          caption?: string | null
          checklist_item_id?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          inspection_id?: string | null
          location?: string | null
          project_id?: string | null
          punch_list_item_id?: string | null
          taken_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_photos_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_photos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_photos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_photos_punch_list_item_id_fkey"
            columns: ["punch_list_item_id"]
            isOneToOne: false
            referencedRelation: "punch_list_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          completed_date: string | null
          created_at: string
          id: string
          inspection_type: Database["public"]["Enums"]["inspection_type"]
          inspector_name: string | null
          inspector_notes: string | null
          project_id: string
          result_notes: string | null
          scheduled_date: string
          status: Database["public"]["Enums"]["inspection_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_date?: string | null
          created_at?: string
          id?: string
          inspection_type: Database["public"]["Enums"]["inspection_type"]
          inspector_name?: string | null
          inspector_notes?: string | null
          project_id: string
          result_notes?: string | null
          scheduled_date: string
          status?: Database["public"]["Enums"]["inspection_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_date?: string | null
          created_at?: string
          id?: string
          inspection_type?: Database["public"]["Enums"]["inspection_type"]
          inspector_name?: string | null
          inspector_notes?: string | null
          project_id?: string
          result_notes?: string | null
          scheduled_date?: string
          status?: Database["public"]["Enums"]["inspection_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      jurisdiction_notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          jurisdiction_id: string
          jurisdiction_name: string
          message: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          jurisdiction_id: string
          jurisdiction_name: string
          message: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          jurisdiction_id?: string
          jurisdiction_name?: string
          message?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      jurisdiction_subscriptions: {
        Row: {
          created_at: string
          id: string
          jurisdiction_id: string
          jurisdiction_name: string
          jurisdiction_state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          jurisdiction_id: string
          jurisdiction_name: string
          jurisdiction_state: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          jurisdiction_id?: string
          jurisdiction_name?: string
          jurisdiction_state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_jurisdiction_subscriptions_jurisdiction"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
        ]
      }
      jurisdictions: {
        Row: {
          accepted_file_formats: string[] | null
          address: string | null
          avg_issuance_days_actual: number | null
          avg_review_days_actual: number | null
          base_permit_fee: number | null
          city: string | null
          commercial_permits_2024: number | null
          county: string | null
          created_at: string
          data_source: string | null
          duplex_units_2024: number | null
          email: string | null
          expedited_available: boolean | null
          expedited_fee_multiplier: number | null
          fee_notes: string | null
          fee_schedule_url: string | null
          fips_place: string | null
          id: string
          inspection_fee: number | null
          inspection_sla_days: number | null
          is_active: boolean | null
          is_high_volume: boolean | null
          last_verified_at: string | null
          mf_3plus_units_2024: number | null
          name: string
          notes: string | null
          permit_issuance_sla_days: number | null
          permit_portal_url: string | null
          phone: string | null
          plan_review_fee: number | null
          plan_review_sla_days: number | null
          residential_units_2024: number | null
          reviewer_contacts: Json | null
          sf_1unit_units_2024: number | null
          special_requirements: string | null
          state: string
          submission_methods: string[] | null
          total_permits_2024: number | null
          updated_at: string
          verified_by: string | null
          website_url: string | null
        }
        Insert: {
          accepted_file_formats?: string[] | null
          address?: string | null
          avg_issuance_days_actual?: number | null
          avg_review_days_actual?: number | null
          base_permit_fee?: number | null
          city?: string | null
          commercial_permits_2024?: number | null
          county?: string | null
          created_at?: string
          data_source?: string | null
          duplex_units_2024?: number | null
          email?: string | null
          expedited_available?: boolean | null
          expedited_fee_multiplier?: number | null
          fee_notes?: string | null
          fee_schedule_url?: string | null
          fips_place?: string | null
          id?: string
          inspection_fee?: number | null
          inspection_sla_days?: number | null
          is_active?: boolean | null
          is_high_volume?: boolean | null
          last_verified_at?: string | null
          mf_3plus_units_2024?: number | null
          name: string
          notes?: string | null
          permit_issuance_sla_days?: number | null
          permit_portal_url?: string | null
          phone?: string | null
          plan_review_fee?: number | null
          plan_review_sla_days?: number | null
          residential_units_2024?: number | null
          reviewer_contacts?: Json | null
          sf_1unit_units_2024?: number | null
          special_requirements?: string | null
          state: string
          submission_methods?: string[] | null
          total_permits_2024?: number | null
          updated_at?: string
          verified_by?: string | null
          website_url?: string | null
        }
        Update: {
          accepted_file_formats?: string[] | null
          address?: string | null
          avg_issuance_days_actual?: number | null
          avg_review_days_actual?: number | null
          base_permit_fee?: number | null
          city?: string | null
          commercial_permits_2024?: number | null
          county?: string | null
          created_at?: string
          data_source?: string | null
          duplex_units_2024?: number | null
          email?: string | null
          expedited_available?: boolean | null
          expedited_fee_multiplier?: number | null
          fee_notes?: string | null
          fee_schedule_url?: string | null
          fips_place?: string | null
          id?: string
          inspection_fee?: number | null
          inspection_sla_days?: number | null
          is_active?: boolean | null
          is_high_volume?: boolean | null
          last_verified_at?: string | null
          mf_3plus_units_2024?: number | null
          name?: string
          notes?: string | null
          permit_issuance_sla_days?: number | null
          permit_portal_url?: string | null
          phone?: string | null
          plan_review_fee?: number | null
          plan_review_sla_days?: number | null
          residential_units_2024?: number | null
          reviewer_contacts?: Json | null
          sf_1unit_units_2024?: number | null
          special_requirements?: string | null
          state?: string
          submission_methods?: string[] | null
          total_permits_2024?: number | null
          updated_at?: string
          verified_by?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      license_validations: {
        Row: {
          created_at: string
          expiration_date: string | null
          filing_id: string
          id: string
          license_number: string
          license_type: string
          professional_name: string
          role_on_project: string | null
          scope_of_license: string | null
          validation_status: string
        }
        Insert: {
          created_at?: string
          expiration_date?: string | null
          filing_id: string
          id?: string
          license_number: string
          license_type: string
          professional_name: string
          role_on_project?: string | null
          scope_of_license?: string | null
          validation_status?: string
        }
        Update: {
          created_at?: string
          expiration_date?: string | null
          filing_id?: string
          id?: string
          license_number?: string
          license_type?: string
          professional_name?: string
          role_on_project?: string | null
          scope_of_license?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "license_validations_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "permit_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      mention_notifications: {
        Row: {
          content_preview: string | null
          created_at: string
          id: string
          is_read: boolean | null
          mentioned_by: string
          project_id: string
          reference_id: string
          reference_type: string
          user_id: string
        }
        Insert: {
          content_preview?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          mentioned_by: string
          project_id: string
          reference_id: string
          reference_type: string
          user_id: string
        }
        Update: {
          content_preview?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          mentioned_by?: string
          project_id?: string
          reference_id?: string
          reference_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mention_notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mention_notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      microsoft_mailbox_connections: {
        Row: {
          client_id: string
          created_at: string
          encrypted_token_json: string
          id: string
          last_checked_at: string | null
          last_connected_at: string | null
          last_error: string | null
          mailbox_email: string
          scopes: string[]
          status: string
          tenant_id: string
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          encrypted_token_json: string
          id?: string
          last_checked_at?: string | null
          last_connected_at?: string | null
          last_error?: string | null
          mailbox_email: string
          scopes?: string[]
          status?: string
          tenant_id: string
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          encrypted_token_json?: string
          id?: string
          last_checked_at?: string | null
          last_connected_at?: string | null
          last_error?: string | null
          mailbox_email?: string
          scopes?: string[]
          status?: string
          tenant_id?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      municipality_configs: {
        Row: {
          agent_config: Json | null
          county: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          license_validation_source: string | null
          login_url: string | null
          municipality_key: string
          permit_types: Json | null
          portal_base_url: string
          portal_type: string
          property_data_source: string | null
          short_name: string
          state: string
        }
        Insert: {
          agent_config?: Json | null
          county?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          license_validation_source?: string | null
          login_url?: string | null
          municipality_key: string
          permit_types?: Json | null
          portal_base_url: string
          portal_type: string
          property_data_source?: string | null
          short_name: string
          state: string
        }
        Update: {
          agent_config?: Json | null
          county?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          license_validation_source?: string | null
          login_url?: string | null
          municipality_key?: string
          permit_types?: Json | null
          portal_base_url?: string
          portal_type?: string
          property_data_source?: string | null
          short_name?: string
          state?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          email_deadline_reminders: boolean
          email_inspection_reminders: boolean
          email_jurisdiction_updates: boolean
          email_project_updates: boolean
          inapp_jurisdiction_updates: boolean
          inapp_notifications: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          email_deadline_reminders?: boolean
          email_inspection_reminders?: boolean
          email_jurisdiction_updates?: boolean
          email_project_updates?: boolean
          inapp_jurisdiction_updates?: boolean
          inapp_notifications?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          email_deadline_reminders?: boolean
          email_inspection_reminders?: boolean
          email_jurisdiction_updates?: boolean
          email_project_updates?: boolean
          inapp_jurisdiction_updates?: boolean
          inapp_notifications?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      parsed_comments: {
        Row: {
          ai_generated_response_text: string | null
          approved_at: string | null
          approved_by: string | null
          assigned_to: string | null
          change_request_note: string | null
          code_reference: string | null
          code_references: string | null
          comment_number: string | null
          confidence: number | null
          created_at: string
          discipline: string | null
          existing_response_text: string | null
          grounded_confidence: string | null
          grounded_evidence: Json | null
          grounded_generated_at: string | null
          id: string
          ingest_source: string
          last_edited_at: string | null
          last_edited_by: string | null
          missing_info_or_risk: string | null
          original_text: string
          page_number: number | null
          previous_comment_text: string | null
          project_id: string
          required_action: string | null
          response_status: string | null
          response_text: string | null
          reviewer_name: string | null
          sheet_reference: string | null
          source_document_id: string | null
          status: string
        }
        Insert: {
          ai_generated_response_text?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_to?: string | null
          change_request_note?: string | null
          code_reference?: string | null
          code_references?: string | null
          comment_number?: string | null
          confidence?: number | null
          created_at?: string
          discipline?: string | null
          existing_response_text?: string | null
          grounded_confidence?: string | null
          grounded_evidence?: Json | null
          grounded_generated_at?: string | null
          id?: string
          ingest_source?: string
          last_edited_at?: string | null
          last_edited_by?: string | null
          missing_info_or_risk?: string | null
          original_text: string
          page_number?: number | null
          previous_comment_text?: string | null
          project_id: string
          required_action?: string | null
          response_status?: string | null
          response_text?: string | null
          reviewer_name?: string | null
          sheet_reference?: string | null
          source_document_id?: string | null
          status?: string
        }
        Update: {
          ai_generated_response_text?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_to?: string | null
          change_request_note?: string | null
          code_reference?: string | null
          code_references?: string | null
          comment_number?: string | null
          confidence?: number | null
          created_at?: string
          discipline?: string | null
          existing_response_text?: string | null
          grounded_confidence?: string | null
          grounded_evidence?: Json | null
          grounded_generated_at?: string | null
          id?: string
          ingest_source?: string
          last_edited_at?: string | null
          last_edited_by?: string | null
          missing_info_or_risk?: string | null
          original_text?: string
          page_number?: number | null
          previous_comment_text?: string | null
          project_id?: string
          required_action?: string | null
          response_status?: string | null
          response_text?: string | null
          reviewer_name?: string | null
          sheet_reference?: string | null
          source_document_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "parsed_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsed_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsed_comments_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      permit_filings: {
        Row: {
          application_id: string | null
          approval_decision: string | null
          approval_notes: string | null
          approval_package: Json | null
          approved_at: string | null
          approved_by: string | null
          confirmation_number: string | null
          construction_value: number | null
          created_at: string
          credential_id: string | null
          estimated_fee: number | null
          filing_status: string
          id: string
          municipality: string | null
          number_of_stories: number | null
          owner_email: string | null
          owner_name: string | null
          owner_phone: string | null
          permit_subtype: string | null
          permit_type: string | null
          project_id: string | null
          property_address: string | null
          property_type: string | null
          review_track: string | null
          scope_of_work: string | null
          square_footage: number | null
          submitted_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          application_id?: string | null
          approval_decision?: string | null
          approval_notes?: string | null
          approval_package?: Json | null
          approved_at?: string | null
          approved_by?: string | null
          confirmation_number?: string | null
          construction_value?: number | null
          created_at?: string
          credential_id?: string | null
          estimated_fee?: number | null
          filing_status?: string
          id?: string
          municipality?: string | null
          number_of_stories?: number | null
          owner_email?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          permit_subtype?: string | null
          permit_type?: string | null
          project_id?: string | null
          property_address?: string | null
          property_type?: string | null
          review_track?: string | null
          scope_of_work?: string | null
          square_footage?: number | null
          submitted_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          application_id?: string | null
          approval_decision?: string | null
          approval_notes?: string | null
          approval_package?: Json | null
          approved_at?: string | null
          approved_by?: string | null
          confirmation_number?: string | null
          construction_value?: number | null
          created_at?: string
          credential_id?: string | null
          estimated_fee?: number | null
          filing_status?: string
          id?: string
          municipality?: string | null
          number_of_stories?: number | null
          owner_email?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          permit_subtype?: string | null
          permit_type?: string | null
          project_id?: string | null
          property_address?: string | null
          property_type?: string | null
          review_track?: string | null
          scope_of_work?: string | null
          square_footage?: number | null
          submitted_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permit_filings_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "portal_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permit_filings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permit_filings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_audit_events: {
        Row: {
          action: string
          actor_id: string | null
          after_json: Json | null
          before_json: Json | null
          correlation_id: string | null
          created_at: string
          feature_key: string | null
          id: string
          project_id: string | null
          result: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          correlation_id?: string | null
          created_at?: string
          feature_key?: string | null
          id?: string
          project_id?: string | null
          result?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          correlation_id?: string | null
          created_at?: string
          feature_key?: string | null
          id?: string
          project_id?: string | null
          result?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_audit_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_credentials: {
        Row: {
          created_at: string
          id: string
          jurisdiction: string
          login_url: string
          permit_number: string | null
          portal_password: string
          portal_username: string
          project_address: string | null
          project_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          jurisdiction: string
          login_url?: string
          permit_number?: string | null
          portal_password: string
          portal_username: string
          project_address?: string | null
          project_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          jurisdiction?: string
          login_url?: string
          permit_number?: string | null
          portal_password?: string
          portal_username?: string
          project_address?: string | null
          project_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_credentials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_credentials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          access_status: string
          company_name: string | null
          created_at: string
          created_by_admin: boolean
          full_name: string | null
          id: string
          job_title: string | null
          must_change_password: boolean
          onboarding_completed: boolean
          password_changed_at: string | null
          phone: string | null
          stripe_customer_id: string | null
          subscription_end: string | null
          subscription_status: string | null
          subscription_tier: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_status?: string
          company_name?: string | null
          created_at?: string
          created_by_admin?: boolean
          full_name?: string | null
          id?: string
          job_title?: string | null
          must_change_password?: boolean
          onboarding_completed?: boolean
          password_changed_at?: string | null
          phone?: string | null
          stripe_customer_id?: string | null
          subscription_end?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_status?: string
          company_name?: string | null
          created_at?: string
          created_by_admin?: boolean
          full_name?: string | null
          id?: string
          job_title?: string | null
          must_change_password?: boolean
          onboarding_completed?: boolean
          password_changed_at?: string | null
          phone?: string | null
          stripe_customer_id?: string | null
          subscription_end?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_activity: {
        Row: {
          activity_type: Database["public"]["Enums"]["activity_type"]
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          project_id: string
          title: string
          user_id: string
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["activity_type"]
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          project_id: string
          title: string
          user_id: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["activity_type"]
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          project_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_chat_messages: {
        Row: {
          content: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          mentions: string[] | null
          project_id: string
          reply_to_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          mentions?: string[] | null
          project_id: string
          reply_to_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          mentions?: string[] | null
          project_id?: string
          reply_to_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_chat_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_chat_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_chat_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "project_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      project_document_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          created_at: string
          document_id: string
          document_type: string | null
          embedding: string | null
          file_name: string | null
          id: string
          metadata: Json
          page_number: number | null
          project_id: string
          sheet_label: string | null
          sheet_title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chunk_index?: number
          chunk_text: string
          created_at?: string
          document_id: string
          document_type?: string | null
          embedding?: string | null
          file_name?: string | null
          id?: string
          metadata?: Json
          page_number?: number | null
          project_id: string
          sheet_label?: string | null
          sheet_title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          document_id?: string
          document_type?: string | null
          embedding?: string | null
          file_name?: string | null
          id?: string
          metadata?: Json
          page_number?: number | null
          project_id?: string
          sheet_label?: string | null
          sheet_title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_document_chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_document_chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_documents: {
        Row: {
          ai_chunk_count: number | null
          ai_ingested_at: string | null
          ai_ingestion_error: string | null
          ai_ingestion_status: string | null
          created_at: string
          description: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id: string
          parent_document_id: string | null
          project_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          ai_chunk_count?: number | null
          ai_ingested_at?: string | null
          ai_ingestion_error?: string | null
          ai_ingestion_status?: string | null
          created_at?: string
          description?: string | null
          document_type?: Database["public"]["Enums"]["document_type"]
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id?: string
          parent_document_id?: string | null
          project_id: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          ai_chunk_count?: number | null
          ai_ingested_at?: string | null
          ai_ingestion_error?: string | null
          ai_ingestion_status?: string | null
          created_at?: string
          description?: string | null
          document_type?: Database["public"]["Enums"]["document_type"]
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string
          id?: string
          parent_document_id?: string | null
          project_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_parent_document_id_fkey"
            columns: ["parent_document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          last_sent_at: string | null
          project_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["team_role"]
          status: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          last_sent_at?: string | null
          project_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          status?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          last_sent_at?: string | null
          project_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          status?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_invitations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_invitations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_pipeline_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          current_stage: string | null
          error_message: string | null
          id: string
          idempotency_key: string | null
          portal_data_hash: string | null
          project_id: string
          stages: Json
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_stage?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          portal_data_hash?: string | null
          project_id: string
          stages?: Json
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_stage?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          portal_data_hash?: string | null
          project_id?: string
          stages?: Json
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_pipeline_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_pipeline_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_share_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          is_active: boolean
          last_viewed_at: string | null
          project_id: string
          token: string
          view_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_viewed_at?: string | null
          project_id: string
          token?: string
          view_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_viewed_at?: string | null
          project_id?: string
          token?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_share_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_share_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_team_members: {
        Row: {
          added_by: string
          created_at: string
          id: string
          project_id: string
          role: Database["public"]["Enums"]["team_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          added_by: string
          created_at?: string
          id?: string
          project_id: string
          role?: Database["public"]["Enums"]["team_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["team_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_team_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_team_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string | null
          approved_at: string | null
          archived_at: string | null
          city: string | null
          client_email: string | null
          client_name: string | null
          contract_value: number | null
          created_at: string
          credential_id: string | null
          data_classification: string
          deadline: string | null
          description: string | null
          estimated_value: number | null
          expeditor_cost: number | null
          id: string
          is_shadow_mode: boolean
          jurisdiction: string | null
          last_checked_at: string | null
          m1_invoice_trigger_status: string | null
          m1_qb_pending_invoice_id: string | null
          m1_trigger_source: string | null
          m1_triggered: boolean
          m1_triggered_at: string | null
          m2_invoice_trigger_status: string | null
          m2_qb_pending_invoice_id: string | null
          m2_trigger_source: string | null
          m2_triggered: boolean
          m2_triggered_at: string | null
          m3_invoice_trigger_status: string | null
          m3_qb_pending_invoice_id: string | null
          m3_trigger_source: string | null
          m3_triggered: boolean
          m3_triggered_at: string | null
          name: string
          notes: string | null
          permit_fee: number | null
          permit_number: string | null
          portal_data: Json | null
          portal_data_hash: string | null
          portal_status: string | null
          project_type: Database["public"]["Enums"]["project_type"] | null
          project_url: string | null
          qb_customer_id: string | null
          qb_invoice_id_m1: string | null
          qb_invoice_id_m2: string | null
          qb_invoice_id_m3: string | null
          reimbursement_amount: number | null
          reimbursement_description: string | null
          rejection_count: number | null
          rejection_reasons: string[] | null
          service_type: string | null
          square_footage: number | null
          state: string | null
          status: Database["public"]["Enums"]["project_status"]
          submitted_at: string | null
          tenant_id: string | null
          total_cost: number | null
          updated_at: string
          user_id: string
          utility_coordination_completed_at: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          approved_at?: string | null
          archived_at?: string | null
          city?: string | null
          client_email?: string | null
          client_name?: string | null
          contract_value?: number | null
          created_at?: string
          credential_id?: string | null
          data_classification?: string
          deadline?: string | null
          description?: string | null
          estimated_value?: number | null
          expeditor_cost?: number | null
          id?: string
          is_shadow_mode?: boolean
          jurisdiction?: string | null
          last_checked_at?: string | null
          m1_invoice_trigger_status?: string | null
          m1_qb_pending_invoice_id?: string | null
          m1_trigger_source?: string | null
          m1_triggered?: boolean
          m1_triggered_at?: string | null
          m2_invoice_trigger_status?: string | null
          m2_qb_pending_invoice_id?: string | null
          m2_trigger_source?: string | null
          m2_triggered?: boolean
          m2_triggered_at?: string | null
          m3_invoice_trigger_status?: string | null
          m3_qb_pending_invoice_id?: string | null
          m3_trigger_source?: string | null
          m3_triggered?: boolean
          m3_triggered_at?: string | null
          name: string
          notes?: string | null
          permit_fee?: number | null
          permit_number?: string | null
          portal_data?: Json | null
          portal_data_hash?: string | null
          portal_status?: string | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          project_url?: string | null
          qb_customer_id?: string | null
          qb_invoice_id_m1?: string | null
          qb_invoice_id_m2?: string | null
          qb_invoice_id_m3?: string | null
          reimbursement_amount?: number | null
          reimbursement_description?: string | null
          rejection_count?: number | null
          rejection_reasons?: string[] | null
          service_type?: string | null
          square_footage?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          submitted_at?: string | null
          tenant_id?: string | null
          total_cost?: number | null
          updated_at?: string
          user_id: string
          utility_coordination_completed_at?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          approved_at?: string | null
          archived_at?: string | null
          city?: string | null
          client_email?: string | null
          client_name?: string | null
          contract_value?: number | null
          created_at?: string
          credential_id?: string | null
          data_classification?: string
          deadline?: string | null
          description?: string | null
          estimated_value?: number | null
          expeditor_cost?: number | null
          id?: string
          is_shadow_mode?: boolean
          jurisdiction?: string | null
          last_checked_at?: string | null
          m1_invoice_trigger_status?: string | null
          m1_qb_pending_invoice_id?: string | null
          m1_trigger_source?: string | null
          m1_triggered?: boolean
          m1_triggered_at?: string | null
          m2_invoice_trigger_status?: string | null
          m2_qb_pending_invoice_id?: string | null
          m2_trigger_source?: string | null
          m2_triggered?: boolean
          m2_triggered_at?: string | null
          m3_invoice_trigger_status?: string | null
          m3_qb_pending_invoice_id?: string | null
          m3_trigger_source?: string | null
          m3_triggered?: boolean
          m3_triggered_at?: string | null
          name?: string
          notes?: string | null
          permit_fee?: number | null
          permit_number?: string | null
          portal_data?: Json | null
          portal_data_hash?: string | null
          portal_status?: string | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          project_url?: string | null
          qb_customer_id?: string | null
          qb_invoice_id_m1?: string | null
          qb_invoice_id_m2?: string | null
          qb_invoice_id_m3?: string | null
          reimbursement_amount?: number | null
          reimbursement_description?: string | null
          rejection_count?: number | null
          rejection_reasons?: string[] | null
          service_type?: string | null
          square_footage?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          submitted_at?: string | null
          tenant_id?: string | null
          total_cost?: number | null
          updated_at?: string
          user_id?: string
          utility_coordination_completed_at?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "portal_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      property_intelligence: {
        Row: {
          active_permits: Json | null
          address: string
          advisory_flags: string[] | null
          created_at: string
          filing_id: string
          flood_hazard_zone: boolean | null
          historic_district: boolean | null
          id: string
          overlay_zones: string[] | null
          raw_data: Json | null
          stop_work_orders: Json | null
          zoning_district: string | null
        }
        Insert: {
          active_permits?: Json | null
          address: string
          advisory_flags?: string[] | null
          created_at?: string
          filing_id: string
          flood_hazard_zone?: boolean | null
          historic_district?: boolean | null
          id?: string
          overlay_zones?: string[] | null
          raw_data?: Json | null
          stop_work_orders?: Json | null
          zoning_district?: string | null
        }
        Update: {
          active_permits?: Json | null
          address?: string
          advisory_flags?: string[] | null
          created_at?: string
          filing_id?: string
          flood_hazard_zone?: boolean | null
          historic_district?: boolean | null
          id?: string
          overlay_zones?: string[] | null
          raw_data?: Json | null
          stop_work_orders?: Json | null
          zoning_district?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_intelligence_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "permit_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      punch_list_items: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          inspection_id: string | null
          location: string | null
          priority: Database["public"]["Enums"]["punch_list_priority"]
          project_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["punch_list_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          inspection_id?: string | null
          location?: string | null
          priority?: Database["public"]["Enums"]["punch_list_priority"]
          project_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["punch_list_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          inspection_id?: string | null
          location?: string | null
          priority?: Database["public"]["Enums"]["punch_list_priority"]
          project_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["punch_list_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "punch_list_items_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_list_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_list_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      quickbooks_connections: {
        Row: {
          access_token: string | null
          access_token_expires_at: string
          company_name: string | null
          created_at: string
          encrypted_refresh_token: string | null
          encrypted_token_version: string | null
          environment: string
          id: string
          realm_id: string
          refresh_token: string | null
          refresh_token_encrypted_at: string | null
          refresh_token_expires_at: string | null
          scopes: string | null
          token_type: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at: string
          company_name?: string | null
          created_at?: string
          encrypted_refresh_token?: string | null
          encrypted_token_version?: string | null
          environment?: string
          id?: string
          realm_id: string
          refresh_token?: string | null
          refresh_token_encrypted_at?: string | null
          refresh_token_expires_at?: string | null
          scopes?: string | null
          token_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string
          company_name?: string | null
          created_at?: string
          encrypted_refresh_token?: string | null
          encrypted_token_version?: string | null
          environment?: string
          id?: string
          realm_id?: string
          refresh_token?: string | null
          refresh_token_encrypted_at?: string | null
          refresh_token_expires_at?: string | null
          scopes?: string | null
          token_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      saved_calculations: {
        Row: {
          calculation_type: string
          created_at: string
          id: string
          input_data: Json
          name: string
          results_data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          calculation_type: string
          created_at?: string
          id?: string
          input_data: Json
          name: string
          results_data: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          calculation_type?: string
          created_at?: string
          id?: string
          input_data?: Json
          name?: string
          results_data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_inspection_checklists: {
        Row: {
          checklist_items: Json
          contractor_signature: string | null
          contractor_signed_at: string | null
          created_at: string
          custom_items: Json
          form_data: Json
          id: string
          inspection_id: string | null
          inspector_signature: string | null
          inspector_signed_at: string | null
          name: string
          project_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checklist_items?: Json
          contractor_signature?: string | null
          contractor_signed_at?: string | null
          created_at?: string
          custom_items?: Json
          form_data?: Json
          id?: string
          inspection_id?: string | null
          inspector_signature?: string | null
          inspector_signed_at?: string | null
          name: string
          project_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checklist_items?: Json
          contractor_signature?: string | null
          contractor_signed_at?: string | null
          created_at?: string
          custom_items?: Json
          form_data?: Json
          id?: string
          inspection_id?: string | null
          inspector_signature?: string | null
          inspector_signed_at?: string | null
          name?: string
          project_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_inspection_checklists_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_inspection_checklists_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_inspection_checklists_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_checklist_reports: {
        Row: {
          created_at: string
          day_of_month: number | null
          day_of_week: number | null
          email_intro: string | null
          email_subject: string | null
          frequency: string
          id: string
          include_details: boolean | null
          include_pdf_attachment: boolean | null
          include_summary: boolean | null
          is_active: boolean | null
          last_sent_at: string | null
          name: string
          next_send_at: string | null
          project_filter: string | null
          recipient_email: string
          recipient_name: string | null
          send_time: string | null
          status_filter: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          email_intro?: string | null
          email_subject?: string | null
          frequency: string
          id?: string
          include_details?: boolean | null
          include_pdf_attachment?: boolean | null
          include_summary?: boolean | null
          is_active?: boolean | null
          last_sent_at?: string | null
          name: string
          next_send_at?: string | null
          project_filter?: string | null
          recipient_email: string
          recipient_name?: string | null
          send_time?: string | null
          status_filter?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          email_intro?: string | null
          email_subject?: string | null
          frequency?: string
          id?: string
          include_details?: boolean | null
          include_pdf_attachment?: boolean | null
          include_summary?: boolean | null
          is_active?: boolean | null
          last_sent_at?: string | null
          name?: string
          next_send_at?: string | null
          project_filter?: string | null
          recipient_email?: string
          recipient_name?: string | null
          send_time?: string | null
          status_filter?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scheduled_notifications: {
        Row: {
          admin_email: string
          admin_user_id: string
          created_at: string
          delivery_status: string | null
          emails_failed_count: number | null
          emails_sent_count: number | null
          error_message: string | null
          id: string
          inapp_sent: number | null
          jurisdiction_id: string
          jurisdiction_name: string
          notification_message: string
          notification_title: string
          processed_at: string | null
          scheduled_for: string
          send_email: boolean | null
          status: string
        }
        Insert: {
          admin_email: string
          admin_user_id: string
          created_at?: string
          delivery_status?: string | null
          emails_failed_count?: number | null
          emails_sent_count?: number | null
          error_message?: string | null
          id?: string
          inapp_sent?: number | null
          jurisdiction_id: string
          jurisdiction_name: string
          notification_message: string
          notification_title: string
          processed_at?: string | null
          scheduled_for: string
          send_email?: boolean | null
          status?: string
        }
        Update: {
          admin_email?: string
          admin_user_id?: string
          created_at?: string
          delivery_status?: string | null
          emails_failed_count?: number | null
          emails_sent_count?: number | null
          error_message?: string | null
          id?: string
          inapp_sent?: number | null
          jurisdiction_id?: string
          jurisdiction_name?: string
          notification_message?: string
          notification_title?: string
          processed_at?: string | null
          scheduled_for?: string
          send_email?: boolean | null
          status?: string
        }
        Relationships: []
      }
      scheduled_report_delivery_logs: {
        Row: {
          created_at: string
          error_message: string | null
          failed_count: number
          failed_emails: string[] | null
          id: string
          recipient_count: number
          recipient_emails: string[]
          report_id: string
          report_name: string
          sent_at: string
          status: string
          successful_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          failed_count?: number
          failed_emails?: string[] | null
          id?: string
          recipient_count?: number
          recipient_emails: string[]
          report_id: string
          report_name: string
          sent_at?: string
          status?: string
          successful_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          failed_count?: number
          failed_emails?: string[] | null
          id?: string
          recipient_count?: number
          recipient_emails?: string[]
          report_id?: string
          report_name?: string
          sent_at?: string
          status?: string
          successful_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_report_delivery_logs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "scheduled_checklist_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          job_id: string
          metadata: Json
          progress_current: number | null
          progress_total: number | null
          project_id: string
          sequence: number
          stage: string | null
          status: string | null
          technical_message: string | null
          user_message: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          job_id: string
          metadata?: Json
          progress_current?: number | null
          progress_total?: number | null
          project_id: string
          sequence: number
          stage?: string | null
          status?: string | null
          technical_message?: string | null
          user_message: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          job_id?: string
          metadata?: Json
          progress_current?: number | null
          progress_total?: number | null
          project_id?: string
          sequence?: number
          stage?: string | null
          status?: string | null
          technical_message?: string | null
          user_message?: string
        }
        Relationships: [
          {
            foreignKeyName: "scrape_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "scrape_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_file_results: {
        Row: {
          created_at: string
          discovered_at: string | null
          failed_at: string | null
          failure_code: string | null
          failure_message: string | null
          file_name: string
          file_version: string
          folder_name: string | null
          id: string
          jurisdiction: string
          metadata: Json
          mime_type: string | null
          parent_folder: string | null
          portal_file_id: string
          progress_current: number | null
          progress_total: number | null
          project_id: string
          public_url: string | null
          scrape_job_id: string
          size_bytes: number | null
          source_url: string | null
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          uploaded_at: string | null
        }
        Insert: {
          created_at?: string
          discovered_at?: string | null
          failed_at?: string | null
          failure_code?: string | null
          failure_message?: string | null
          file_name: string
          file_version?: string
          folder_name?: string | null
          id?: string
          jurisdiction: string
          metadata?: Json
          mime_type?: string | null
          parent_folder?: string | null
          portal_file_id: string
          progress_current?: number | null
          progress_total?: number | null
          project_id: string
          public_url?: string | null
          scrape_job_id: string
          size_bytes?: number | null
          source_url?: string | null
          started_at?: string | null
          status: string
          storage_path?: string | null
          updated_at?: string
          uploaded_at?: string | null
        }
        Update: {
          created_at?: string
          discovered_at?: string | null
          failed_at?: string | null
          failure_code?: string | null
          failure_message?: string | null
          file_name?: string
          file_version?: string
          folder_name?: string | null
          id?: string
          jurisdiction?: string
          metadata?: Json
          mime_type?: string | null
          parent_folder?: string | null
          portal_file_id?: string
          progress_current?: number | null
          progress_total?: number | null
          project_id?: string
          public_url?: string | null
          scrape_job_id?: string
          size_bytes?: number | null
          source_url?: string | null
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scrape_file_results_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_file_results_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_file_results_scrape_job_id_fkey"
            columns: ["scrape_job_id"]
            isOneToOne: false
            referencedRelation: "scrape_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_jobs: {
        Row: {
          attachments_state: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          canonical_job_id: string | null
          checkpoint_version: number
          completed_at: string | null
          coordination_record_id: string | null
          created_at: string
          credential_id: string | null
          current_stage: string | null
          current_user_message: string | null
          dispatch_priority: number
          error_code: string | null
          error_user_message: string | null
          explicitly_resumed_at: string | null
          id: string
          job_type: string | null
          jurisdiction: string
          last_activity_at: string | null
          last_error: string | null
          last_heartbeat_at: string | null
          last_worker_started_at: string | null
          lease_expires_at: string | null
          lease_heartbeat_at: string | null
          lease_worker_id: string | null
          metadata: Json
          next_attempt_at: string | null
          normalized_permit_number: string | null
          normalized_scope_key: string | null
          permit_number: string | null
          phase: string | null
          plan_review_state: string | null
          portal_type: string | null
          progress_current: number | null
          progress_total: number | null
          project_id: string
          project_info_state: string | null
          requested_at: string | null
          requested_scope: Json
          run_intent: string
          scrape_mode: string | null
          scraper_session_id: string | null
          started_at: string | null
          status: string
          tenant_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attachments_state?: string | null
          attempt_count?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          canonical_job_id?: string | null
          checkpoint_version?: number
          completed_at?: string | null
          coordination_record_id?: string | null
          created_at?: string
          credential_id?: string | null
          current_stage?: string | null
          current_user_message?: string | null
          dispatch_priority?: number
          error_code?: string | null
          error_user_message?: string | null
          explicitly_resumed_at?: string | null
          id?: string
          job_type?: string | null
          jurisdiction: string
          last_activity_at?: string | null
          last_error?: string | null
          last_heartbeat_at?: string | null
          last_worker_started_at?: string | null
          lease_expires_at?: string | null
          lease_heartbeat_at?: string | null
          lease_worker_id?: string | null
          metadata?: Json
          next_attempt_at?: string | null
          normalized_permit_number?: string | null
          normalized_scope_key?: string | null
          permit_number?: string | null
          phase?: string | null
          plan_review_state?: string | null
          portal_type?: string | null
          progress_current?: number | null
          progress_total?: number | null
          project_id: string
          project_info_state?: string | null
          requested_at?: string | null
          requested_scope?: Json
          run_intent?: string
          scrape_mode?: string | null
          scraper_session_id?: string | null
          started_at?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attachments_state?: string | null
          attempt_count?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          canonical_job_id?: string | null
          checkpoint_version?: number
          completed_at?: string | null
          coordination_record_id?: string | null
          created_at?: string
          credential_id?: string | null
          current_stage?: string | null
          current_user_message?: string | null
          dispatch_priority?: number
          error_code?: string | null
          error_user_message?: string | null
          explicitly_resumed_at?: string | null
          id?: string
          job_type?: string | null
          jurisdiction?: string
          last_activity_at?: string | null
          last_error?: string | null
          last_heartbeat_at?: string | null
          last_worker_started_at?: string | null
          lease_expires_at?: string | null
          lease_heartbeat_at?: string | null
          lease_worker_id?: string | null
          metadata?: Json
          next_attempt_at?: string | null
          normalized_permit_number?: string | null
          normalized_scope_key?: string | null
          permit_number?: string | null
          phase?: string | null
          plan_review_state?: string | null
          portal_type?: string | null
          progress_current?: number | null
          progress_total?: number | null
          project_id?: string
          project_info_state?: string | null
          requested_at?: string | null
          requested_scope?: Json
          run_intent?: string
          scrape_mode?: string | null
          scraper_session_id?: string | null
          started_at?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scrape_jobs_canonical_job_id_fkey"
            columns: ["canonical_job_id"]
            isOneToOne: false
            referencedRelation: "scrape_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_jobs_coordination_record_id_fkey"
            columns: ["coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_jobs_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "portal_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_predictions: {
        Row: {
          agent_name: string
          comment_id: string
          confidence_score: number
          created_at: string
          id: string
          match_status: string
          prediction_data: Json
          project_id: string
        }
        Insert: {
          agent_name: string
          comment_id: string
          confidence_score: number
          created_at?: string
          id?: string
          match_status?: string
          prediction_data?: Json
          project_id: string
        }
        Update: {
          agent_name?: string
          comment_id?: string
          confidence_score?: number
          created_at?: string
          id?: string
          match_status?: string
          prediction_data?: Json
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shadow_predictions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "parsed_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shadow_predictions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shadow_predictions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_assignments: {
        Row: {
          assigned_at: string
          completed_at: string | null
          created_at: string
          hours_worked: number | null
          id: string
          notes: string | null
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          completed_at?: string | null
          created_at?: string
          hours_worked?: number | null
          id?: string
          notes?: string | null
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          completed_at?: string | null
          created_at?: string
          hours_worked?: number | null
          id?: string
          notes?: string | null
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_preparations: {
        Row: {
          application_id: string
          attachments: Json
          blockers: Json
          body: string | null
          cc_recipients: Json
          confirmation_idempotency_key: string | null
          confirmation_message: string | null
          confirmed_at: string | null
          coordination_record_id: string
          created_at: string
          external_side_effects: Json
          graph_send_attempted: boolean
          id: string
          method: string
          operator_user_id: string | null
          package_snapshot_captured_at: string | null
          package_snapshot_id: string | null
          package_snapshot_version: string | null
          prepared_at: string
          project_id: string
          project_name: string | null
          provider_slug: string | null
          reviewed_snapshot_bindings: Json
          sender_mailbox: string | null
          sender_mailbox_verified: boolean
          sending_enabled: boolean
          status: string
          subject: string | null
          to_recipients: Json
          updated_at: string
        }
        Insert: {
          application_id: string
          attachments?: Json
          blockers?: Json
          body?: string | null
          cc_recipients?: Json
          confirmation_idempotency_key?: string | null
          confirmation_message?: string | null
          confirmed_at?: string | null
          coordination_record_id: string
          created_at?: string
          external_side_effects?: Json
          graph_send_attempted?: boolean
          id?: string
          method?: string
          operator_user_id?: string | null
          package_snapshot_captured_at?: string | null
          package_snapshot_id?: string | null
          package_snapshot_version?: string | null
          prepared_at?: string
          project_id: string
          project_name?: string | null
          provider_slug?: string | null
          reviewed_snapshot_bindings?: Json
          sender_mailbox?: string | null
          sender_mailbox_verified?: boolean
          sending_enabled?: boolean
          status?: string
          subject?: string | null
          to_recipients?: Json
          updated_at?: string
        }
        Update: {
          application_id?: string
          attachments?: Json
          blockers?: Json
          body?: string | null
          cc_recipients?: Json
          confirmation_idempotency_key?: string | null
          confirmation_message?: string | null
          confirmed_at?: string | null
          coordination_record_id?: string
          created_at?: string
          external_side_effects?: Json
          graph_send_attempted?: boolean
          id?: string
          method?: string
          operator_user_id?: string | null
          package_snapshot_captured_at?: string | null
          package_snapshot_id?: string | null
          package_snapshot_version?: string | null
          prepared_at?: string
          project_id?: string
          project_name?: string | null
          provider_slug?: string | null
          reviewed_snapshot_bindings?: Json
          sender_mailbox?: string | null
          sender_mailbox_verified?: boolean
          sending_enabled?: boolean
          status?: string
          subject?: string | null
          to_recipients?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_preparations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "coordination_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_preparations_record_fkey"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      submission_transmission_attempts: {
        Row: {
          application_id: string
          attachment_count: number
          attachment_names: Json
          body_preview: string | null
          cc_recipients: Json
          claimed_at: string
          completed_at: string | null
          coordination_record_id: string
          created_at: string
          external_side_effects: Json
          graph_error: string | null
          graph_http_status: number | null
          graph_message_id: string | null
          graph_send_attempted: boolean
          id: string
          idempotency_key: string
          method: string
          operator_user_id: string | null
          outcome_detail: Json
          package_snapshot_id: string | null
          package_snapshot_version: string | null
          preparation_id: string | null
          project_id: string
          sender_mailbox: string | null
          status: string
          subject: string | null
          to_recipients: Json
          updated_at: string
        }
        Insert: {
          application_id: string
          attachment_count?: number
          attachment_names?: Json
          body_preview?: string | null
          cc_recipients?: Json
          claimed_at?: string
          completed_at?: string | null
          coordination_record_id: string
          created_at?: string
          external_side_effects?: Json
          graph_error?: string | null
          graph_http_status?: number | null
          graph_message_id?: string | null
          graph_send_attempted?: boolean
          id?: string
          idempotency_key: string
          method?: string
          operator_user_id?: string | null
          outcome_detail?: Json
          package_snapshot_id?: string | null
          package_snapshot_version?: string | null
          preparation_id?: string | null
          project_id: string
          sender_mailbox?: string | null
          status?: string
          subject?: string | null
          to_recipients?: Json
          updated_at?: string
        }
        Update: {
          application_id?: string
          attachment_count?: number
          attachment_names?: Json
          body_preview?: string | null
          cc_recipients?: Json
          claimed_at?: string
          completed_at?: string | null
          coordination_record_id?: string
          created_at?: string
          external_side_effects?: Json
          graph_error?: string | null
          graph_http_status?: number | null
          graph_message_id?: string | null
          graph_send_attempted?: boolean
          id?: string
          idempotency_key?: string
          method?: string
          operator_user_id?: string | null
          outcome_detail?: Json
          package_snapshot_id?: string | null
          package_snapshot_version?: string | null
          preparation_id?: string | null
          project_id?: string
          sender_mailbox?: string | null
          status?: string
          subject?: string | null
          to_recipients?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_transmission_attempts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "coordination_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_transmission_attempts_preparation_id_fkey"
            columns: ["preparation_id"]
            isOneToOne: false
            referencedRelation: "submission_preparations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_transmission_attempts_record_fkey"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      submission_validation_attempts: {
        Row: {
          application_id: string
          attachments: Json
          attempt_mode: string
          blockers: Json
          coordination_record_id: string
          created_at: string
          external_side_effects: Json
          id: string
          intended_submission_mode: string
          operator_user_id: string | null
          package_snapshot_captured_at: string | null
          package_snapshot_id: string | null
          package_snapshot_version: string | null
          project_id: string
          provider_slug: string | null
          result: string
          validated_at: string
          validation_payload: Json
          warnings: Json
        }
        Insert: {
          application_id: string
          attachments?: Json
          attempt_mode?: string
          blockers?: Json
          coordination_record_id: string
          created_at?: string
          external_side_effects?: Json
          id?: string
          intended_submission_mode?: string
          operator_user_id?: string | null
          package_snapshot_captured_at?: string | null
          package_snapshot_id?: string | null
          package_snapshot_version?: string | null
          project_id: string
          provider_slug?: string | null
          result: string
          validated_at?: string
          validation_payload?: Json
          warnings?: Json
        }
        Update: {
          application_id?: string
          attachments?: Json
          attempt_mode?: string
          blockers?: Json
          coordination_record_id?: string
          created_at?: string
          external_side_effects?: Json
          id?: string
          intended_submission_mode?: string
          operator_user_id?: string | null
          package_snapshot_captured_at?: string | null
          package_snapshot_id?: string | null
          package_snapshot_version?: string | null
          project_id?: string
          provider_slug?: string | null
          result?: string
          validated_at?: string
          validation_payload?: Json
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "submission_validation_attempts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "coordination_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_validation_attempts_record_fkey"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["tenant_membership_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_membership_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_membership_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_demo: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      uci_coordination_document_links: {
        Row: {
          coordination_record_id: string
          created_at: string
          id: string
          included_in_analysis: boolean
          link_origin: string
          link_role: string
          linked_at: string
          linked_by: string | null
          project_document_id: string
          project_id: string
          relevance: string
          source_provider_id: string | null
          source_provider_name: string | null
          source_provider_slug: string | null
          source_utility_type: string | null
          tenant_id: string | null
          unlink_reason: string | null
          unlinked_at: string | null
          unlinked_by: string | null
          updated_at: string
        }
        Insert: {
          coordination_record_id: string
          created_at?: string
          id?: string
          included_in_analysis?: boolean
          link_origin?: string
          link_role?: string
          linked_at?: string
          linked_by?: string | null
          project_document_id: string
          project_id: string
          relevance?: string
          source_provider_id?: string | null
          source_provider_name?: string | null
          source_provider_slug?: string | null
          source_utility_type?: string | null
          tenant_id?: string | null
          unlink_reason?: string | null
          unlinked_at?: string | null
          unlinked_by?: string | null
          updated_at?: string
        }
        Update: {
          coordination_record_id?: string
          created_at?: string
          id?: string
          included_in_analysis?: boolean
          link_origin?: string
          link_role?: string
          linked_at?: string
          linked_by?: string | null
          project_document_id?: string
          project_id?: string
          relevance?: string
          source_provider_id?: string | null
          source_provider_name?: string | null
          source_provider_slug?: string | null
          source_utility_type?: string | null
          tenant_id?: string | null
          unlink_reason?: string | null
          unlinked_at?: string | null
          unlinked_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uci_coordination_document_links_project_document_id_fkey"
            columns: ["project_document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uci_coordination_document_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uci_coordination_document_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uci_coordination_document_links_project_record_fk"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      uci_document_registry_entries: {
        Row: {
          classification_review: string
          classified_at: string | null
          coordination_record_id: string
          created_at: string
          detected_role: string | null
          effective_role: string | null
          id: string
          manual_role: string | null
          metadata: Json
          project_document_id: string
          project_id: string
          provenance: string
          provider_slot_keys: string[]
          role_confidence: string
          role_overridden_at: string | null
          role_overridden_by: string | null
          signature_status: string | null
          signed_project_document_id: string | null
          stage_consumers: number[]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          classification_review?: string
          classified_at?: string | null
          coordination_record_id: string
          created_at?: string
          detected_role?: string | null
          effective_role?: string | null
          id?: string
          manual_role?: string | null
          metadata?: Json
          project_document_id: string
          project_id: string
          provenance?: string
          provider_slot_keys?: string[]
          role_confidence?: string
          role_overridden_at?: string | null
          role_overridden_by?: string | null
          signature_status?: string | null
          signed_project_document_id?: string | null
          stage_consumers?: number[]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          classification_review?: string
          classified_at?: string | null
          coordination_record_id?: string
          created_at?: string
          detected_role?: string | null
          effective_role?: string | null
          id?: string
          manual_role?: string | null
          metadata?: Json
          project_document_id?: string
          project_id?: string
          provenance?: string
          provider_slot_keys?: string[]
          role_confidence?: string
          role_overridden_at?: string | null
          role_overridden_by?: string | null
          signature_status?: string | null
          signed_project_document_id?: string | null
          stage_consumers?: number[]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uci_document_registry_entries_project_document_id_fkey"
            columns: ["project_document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uci_document_registry_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uci_document_registry_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uci_document_registry_entries_project_record_fk"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "uci_document_registry_entries_signed_project_document_id_fkey"
            columns: ["signed_project_document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      uci_graph_inbound_mailbox_state: {
        Row: {
          created_at: string
          last_cycle_metrics: Json
          last_poll_finished_at: string | null
          last_poll_started_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          updated_at: string
          user_id: string
          watermark_received_at: string | null
        }
        Insert: {
          created_at?: string
          last_cycle_metrics?: Json
          last_poll_finished_at?: string | null
          last_poll_started_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          updated_at?: string
          user_id: string
          watermark_received_at?: string | null
        }
        Update: {
          created_at?: string
          last_cycle_metrics?: Json
          last_poll_finished_at?: string | null
          last_poll_started_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          updated_at?: string
          user_id?: string
          watermark_received_at?: string | null
        }
        Relationships: []
      }
      uci_portal_harvest_items: {
        Row: {
          created_at: string
          external_application_id: string
          external_job_id: string | null
          id: string
          last_synced_at: string
          owner_user_id: string
          portal_milestone: string | null
          portal_status: string | null
          provider_slug: string
          snapshot: Json
          source_credential_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_application_id: string
          external_job_id?: string | null
          id?: string
          last_synced_at?: string
          owner_user_id: string
          portal_milestone?: string | null
          portal_status?: string | null
          provider_slug: string
          snapshot?: Json
          source_credential_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_application_id?: string
          external_job_id?: string | null
          id?: string
          last_synced_at?: string
          owner_user_id?: string
          portal_milestone?: string | null
          portal_status?: string | null
          provider_slug?: string
          snapshot?: Json
          source_credential_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uci_portal_harvest_items_source_credential_id_fkey"
            columns: ["source_credential_id"]
            isOneToOne: false
            referencedRelation: "portal_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      uci_portal_harvest_links: {
        Row: {
          coordination_record_id: string
          external_application_id: string
          id: string
          linked_at: string
          linked_by: string | null
          project_id: string
          provider_slug: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          coordination_record_id: string
          external_application_id: string
          id?: string
          linked_at?: string
          linked_by?: string | null
          project_id: string
          provider_slug: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          coordination_record_id?: string
          external_application_id?: string
          id?: string
          linked_at?: string
          linked_by?: string | null
          project_id?: string
          provider_slug?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uci_portal_harvest_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uci_portal_harvest_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uci_portal_harvest_links_project_record_fk"
            columns: ["project_id", "coordination_record_id"]
            isOneToOne: false
            referencedRelation: "coordination_records"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      uci_unmatched_inbound_messages: {
        Row: {
          agent_processed_metadata: Json
          channel: string
          conversation_id: string | null
          created_at: string
          direction: string
          external_message_id: string | null
          id: string
          idempotency_key: string
          internet_message_id: string | null
          last_match_attempted_at: string | null
          mailbox_user_id: string | null
          match_candidates: Json
          match_status: string
          matched_communication_id: string | null
          matched_coordination_record_id: string | null
          message_timestamp: string | null
          needs_human_attention: boolean
          next_rematch_at: string | null
          project_id: string | null
          provider_slug: string | null
          raw_attachments: Json
          raw_body: string | null
          raw_subject: string | null
          recipient: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sender: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          agent_processed_metadata?: Json
          channel?: string
          conversation_id?: string | null
          created_at?: string
          direction?: string
          external_message_id?: string | null
          id?: string
          idempotency_key: string
          internet_message_id?: string | null
          last_match_attempted_at?: string | null
          mailbox_user_id?: string | null
          match_candidates?: Json
          match_status?: string
          matched_communication_id?: string | null
          matched_coordination_record_id?: string | null
          message_timestamp?: string | null
          needs_human_attention?: boolean
          next_rematch_at?: string | null
          project_id?: string | null
          provider_slug?: string | null
          raw_attachments?: Json
          raw_body?: string | null
          raw_subject?: string | null
          recipient?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_processed_metadata?: Json
          channel?: string
          conversation_id?: string | null
          created_at?: string
          direction?: string
          external_message_id?: string | null
          id?: string
          idempotency_key?: string
          internet_message_id?: string | null
          last_match_attempted_at?: string | null
          mailbox_user_id?: string | null
          match_candidates?: Json
          match_status?: string
          matched_communication_id?: string | null
          matched_coordination_record_id?: string | null
          message_timestamp?: string | null
          needs_human_attention?: boolean
          next_rematch_at?: string | null
          project_id?: string | null
          provider_slug?: string | null
          raw_attachments?: Json
          raw_body?: string | null
          raw_subject?: string | null
          recipient?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_access_reviews: {
        Row: {
          reviewed_at: string
          reviewed_by: string
          user_id: string
        }
        Insert: {
          reviewed_at?: string
          reviewed_by: string
          user_id: string
        }
        Update: {
          reviewed_at?: string
          reviewed_by?: string
          user_id?: string
        }
        Relationships: []
      }
      user_drip_campaigns: {
        Row: {
          campaign_type: string
          completed_at: string | null
          created_at: string
          email: string
          emails_sent: number
          enrolled_at: string
          id: string
          is_active: boolean
          last_email_sent_at: string | null
          updated_at: string
          user_id: string
          user_name: string | null
        }
        Insert: {
          campaign_type?: string
          completed_at?: string | null
          created_at?: string
          email: string
          emails_sent?: number
          enrolled_at?: string
          id?: string
          is_active?: boolean
          last_email_sent_at?: string | null
          updated_at?: string
          user_id: string
          user_name?: string | null
        }
        Update: {
          campaign_type?: string
          completed_at?: string | null
          created_at?: string
          email?: string
          emails_sent?: number
          enrolled_at?: string
          id?: string
          is_active?: boolean
          last_email_sent_at?: string | null
          updated_at?: string
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      user_feature_permissions: {
        Row: {
          access_level: string
          created_at: string
          feature_key: string
          granted_by: string | null
          id: string
          project_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_level?: string
          created_at?: string
          feature_key: string
          granted_by?: string | null
          id?: string
          project_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_level?: string
          created_at?: string
          feature_key?: string
          granted_by?: string | null
          id?: string
          project_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_feature_permissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_feature_permissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_portal_credential_grants: {
        Row: {
          created_at: string
          credential_id: string
          grant_level: string
          granted_by: string | null
          id: string
          jurisdiction: string | null
          project_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credential_id: string
          grant_level?: string
          granted_by?: string | null
          id?: string
          jurisdiction?: string | null
          project_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credential_id?: string
          grant_level?: string
          granted_by?: string | null
          id?: string
          jurisdiction?: string | null
          project_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_portal_credential_grants_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "portal_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_portal_credential_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_portal_credential_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_project_access_overrides: {
        Row: {
          access_level: string
          created_at: string
          granted_by: string | null
          id: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_level: string
          created_at?: string
          granted_by?: string | null
          id?: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_level?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_project_access_overrides_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_project_access_overrides_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_scraped_data_scope: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          scope_ref: string
          scope_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          scope_ref: string
          scope_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          scope_ref?: string
          scope_type?: string
          user_id?: string
        }
        Relationships: []
      }
      utility_provider_aliases: {
        Row: {
          alias_display: string
          alias_normalized: string
          alias_source: string
          created_at: string
          id: string
          provider_id: string
          updated_at: string
        }
        Insert: {
          alias_display: string
          alias_normalized: string
          alias_source?: string
          created_at?: string
          id?: string
          provider_id: string
          updated_at?: string
        }
        Update: {
          alias_display?: string
          alias_normalized?: string
          alias_source?: string
          created_at?: string
          id?: string
          provider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "utility_provider_aliases_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "utility_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      utility_providers: {
        Row: {
          automation_status: string
          canonical_name: string | null
          cet_relationship: boolean
          created_at: string
          directory_source: Json | null
          display_name: string | null
          id: string
          is_active: boolean
          is_global_template: boolean
          name: string
          notes: string | null
          ownership_type: string | null
          portal_credentials_ref: string | null
          portal_key: string | null
          portal_url: string | null
          primary_contact: Json | null
          primary_portal_type: string | null
          service_territory: Json | null
          sla_acknowledgment_business_days: number
          sla_ciac_confirmation_business_days: number
          sla_class_of_service_business_days: number
          slug: string
          source_template_id: string | null
          tenant_id: string | null
          uci_application_templates: Json
          updated_at: string
          utility_type: string
        }
        Insert: {
          automation_status?: string
          canonical_name?: string | null
          cet_relationship?: boolean
          created_at?: string
          directory_source?: Json | null
          display_name?: string | null
          id?: string
          is_active?: boolean
          is_global_template?: boolean
          name: string
          notes?: string | null
          ownership_type?: string | null
          portal_credentials_ref?: string | null
          portal_key?: string | null
          portal_url?: string | null
          primary_contact?: Json | null
          primary_portal_type?: string | null
          service_territory?: Json | null
          sla_acknowledgment_business_days?: number
          sla_ciac_confirmation_business_days?: number
          sla_class_of_service_business_days?: number
          slug: string
          source_template_id?: string | null
          tenant_id?: string | null
          uci_application_templates?: Json
          updated_at?: string
          utility_type: string
        }
        Update: {
          automation_status?: string
          canonical_name?: string | null
          cet_relationship?: boolean
          created_at?: string
          directory_source?: Json | null
          display_name?: string | null
          id?: string
          is_active?: boolean
          is_global_template?: boolean
          name?: string
          notes?: string | null
          ownership_type?: string | null
          portal_credentials_ref?: string | null
          portal_key?: string | null
          portal_url?: string | null
          primary_contact?: Json | null
          primary_portal_type?: string | null
          service_territory?: Json | null
          sla_acknowledgment_business_days?: number
          sla_ciac_confirmation_business_days?: number
          sla_class_of_service_business_days?: number
          slug?: string
          source_template_id?: string | null
          tenant_id?: string | null
          uci_application_templates?: Json
          updated_at?: string
          utility_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "utility_providers_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "utility_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_providers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      utility_stage_duration_baselines: {
        Row: {
          created_at: string
          from_stage: number
          id: string
          ownership_type: string
          p50_business_days: number
          source: string
          to_stage: number
          updated_at: string
          utility_type: string
        }
        Insert: {
          created_at?: string
          from_stage: number
          id?: string
          ownership_type: string
          p50_business_days: number
          source?: string
          to_stage?: number
          updated_at?: string
          utility_type: string
        }
        Update: {
          created_at?: string
          from_stage?: number
          id?: string
          ownership_type?: string
          p50_business_days?: number
          source?: string
          to_stage?: number
          updated_at?: string
          utility_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      project_analytics: {
        Row: {
          approved_at: string | null
          created_at: string | null
          document_count: number | null
          draft_to_submit_days: number | null
          expeditor_cost: number | null
          failed_inspection_count: number | null
          id: string | null
          inspection_count: number | null
          jurisdiction: string | null
          name: string | null
          open_punch_items: number | null
          permit_fee: number | null
          project_type: Database["public"]["Enums"]["project_type"] | null
          punch_list_count: number | null
          rejection_count: number | null
          rejection_reasons: string[] | null
          status: Database["public"]["Enums"]["project_status"] | null
          submit_to_approval_days: number | null
          submitted_at: string | null
          total_cost: number | null
          total_cycle_days: number | null
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          created_at?: string | null
          document_count?: never
          draft_to_submit_days?: never
          expeditor_cost?: number | null
          failed_inspection_count?: never
          id?: string | null
          inspection_count?: never
          jurisdiction?: string | null
          name?: string | null
          open_punch_items?: never
          permit_fee?: number | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          punch_list_count?: never
          rejection_count?: number | null
          rejection_reasons?: string[] | null
          status?: Database["public"]["Enums"]["project_status"] | null
          submit_to_approval_days?: never
          submitted_at?: string | null
          total_cost?: number | null
          total_cycle_days?: never
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          created_at?: string | null
          document_count?: never
          draft_to_submit_days?: never
          expeditor_cost?: number | null
          failed_inspection_count?: never
          id?: string | null
          inspection_count?: never
          jurisdiction?: string | null
          name?: string | null
          open_punch_items?: never
          permit_fee?: number | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          punch_list_count?: never
          rejection_count?: number | null
          rejection_reasons?: string[] | null
          status?: Database["public"]["Enums"]["project_status"] | null
          submit_to_approval_days?: never
          submitted_at?: string | null
          total_cost?: number | null
          total_cycle_days?: never
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _active_user_default_feature_access: {
        Args: { p_feature_key: string }
        Returns: string
      }
      _admin_require_backend_caller: { Args: never; Returns: undefined }
      _admin_require_platform_admin: { Args: never; Returns: undefined }
      _admin_require_super_admin: { Args: never; Returns: undefined }
      _admin_resolve_actor: { Args: { p_actor_id?: string }; Returns: string }
      _default_credential_grant_level: {
        Args: { p_user_id: string }
        Returns: string
      }
      _feature_level_rank: { Args: { p_level: string }; Returns: number }
      _global_feature_access_level: {
        Args: { p_feature_key: string; p_user_id: string }
        Returns: string
      }
      _governance_enforce_mode: { Args: never; Returns: string }
      _grant_level_rank: { Args: { p_level: string }; Returns: number }
      _normalize_invite_email: { Args: { p_email: string }; Returns: string }
      _platform_admin_count: { Args: never; Returns: number }
      _project_invitation_token_hash: {
        Args: { p_token: string }
        Returns: string
      }
      _project_role_default_feature_access: {
        Args: { p_feature_key: string; p_project_id: string; p_user_id: string }
        Returns: string
      }
      _resolve_feature_access_level: {
        Args: { p_feature_key: string; p_project_id: string; p_user_id: string }
        Returns: string
      }
      _resolve_project_access_level: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: string
      }
      _slugify_tenant_label: {
        Args: { p_label: string; p_user_id: string }
        Returns: string
      }
      _super_admin_count: { Args: never; Returns: number }
      _user_has_scraped_data_scope: {
        Args: {
          p_jurisdiction?: string
          p_portal_source?: string
          p_project_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      accept_project_team_invitation: {
        Args: { p_accept_token: string }
        Returns: Json
      }
      admin_activate_user: {
        Args: { p_actor_id?: string; p_reason?: string; p_user_id: string }
        Returns: Json
      }
      admin_append_audit_event: {
        Args: {
          p_action: string
          p_actor_id?: string
          p_after_json?: Json
          p_before_json?: Json
          p_correlation_id?: string
          p_feature_key?: string
          p_project_id?: string
          p_result?: string
          p_target_id?: string
          p_target_type?: string
        }
        Returns: string
      }
      admin_copy_permissions: {
        Args: {
          p_actor_id?: string
          p_from_user_id: string
          p_to_user_id: string
        }
        Returns: Json
      }
      admin_deactivate_user: {
        Args: { p_actor_id?: string; p_reason?: string; p_user_id: string }
        Returns: Json
      }
      admin_delete_feature_permission: {
        Args: {
          p_actor_id?: string
          p_feature_key: string
          p_project_id: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_get_effective_permissions: {
        Args: { p_user_id: string }
        Returns: Json
      }
      admin_list_audit_events: {
        Args: {
          p_action?: string
          p_actor_id?: string
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_from_date?: string
          p_limit?: number
          p_target_type?: string
          p_to_date?: string
        }
        Returns: Json
      }
      admin_list_member_directory: { Args: never; Returns: Json }
      admin_overview_metrics: { Args: never; Returns: Json }
      admin_set_credential_grant: {
        Args: {
          p_actor_id?: string
          p_credential_id: string
          p_grant_level: string
          p_jurisdiction?: string
          p_project_id?: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_set_feature_permission: {
        Args: {
          p_access_level: string
          p_actor_id?: string
          p_feature_key: string
          p_project_id: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_set_scraped_data_scope: {
        Args: {
          p_actor_id?: string
          p_scope_ref: string
          p_scope_type: string
          p_user_id: string
        }
        Returns: Json
      }
      assert_credential_grant: {
        Args: {
          p_credential_id: string
          p_required_level?: string
          p_user_id: string
        }
        Returns: boolean
      }
      assert_feature_access: {
        Args: {
          p_feature_key: string
          p_project_id: string
          p_required_level?: string
          p_user_id: string
        }
        Returns: boolean
      }
      assert_scraped_data_access: {
        Args: {
          p_jurisdiction?: string
          p_portal_source?: string
          p_project_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      bulk_upsert_jurisdiction_volume: {
        Args: { p_mode?: string; p_rows: Json }
        Returns: Json
      }
      can_access_tenant: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      cancel_arlington_scrape_job: {
        Args: { p_job_id: string; p_project_id: string; p_user_id?: string }
        Returns: {
          already_terminal: boolean
          cancellation_reason: string
          job_id: string
          status: string
        }[]
      }
      cancel_uci_portal_sync_job: {
        Args: { p_job_id: string; p_project_id: string; p_user_id?: string }
        Returns: {
          attachments_state: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          canonical_job_id: string | null
          checkpoint_version: number
          completed_at: string | null
          coordination_record_id: string | null
          created_at: string
          credential_id: string | null
          current_stage: string | null
          current_user_message: string | null
          dispatch_priority: number
          error_code: string | null
          error_user_message: string | null
          explicitly_resumed_at: string | null
          id: string
          job_type: string | null
          jurisdiction: string
          last_activity_at: string | null
          last_error: string | null
          last_heartbeat_at: string | null
          last_worker_started_at: string | null
          lease_expires_at: string | null
          lease_heartbeat_at: string | null
          lease_worker_id: string | null
          metadata: Json
          next_attempt_at: string | null
          normalized_permit_number: string | null
          normalized_scope_key: string | null
          permit_number: string | null
          phase: string | null
          plan_review_state: string | null
          portal_type: string | null
          progress_current: number | null
          progress_total: number | null
          project_id: string
          project_info_state: string | null
          requested_at: string | null
          requested_scope: Json
          run_intent: string
          scrape_mode: string | null
          scraper_session_id: string | null
          started_at: string | null
          status: string
          tenant_id: string | null
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "scrape_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_arlington_scrape_job: {
        Args: { p_lease_ttl_seconds?: number; p_worker_id: string }
        Returns: {
          attachments_state: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          canonical_job_id: string | null
          checkpoint_version: number
          completed_at: string | null
          coordination_record_id: string | null
          created_at: string
          credential_id: string | null
          current_stage: string | null
          current_user_message: string | null
          dispatch_priority: number
          error_code: string | null
          error_user_message: string | null
          explicitly_resumed_at: string | null
          id: string
          job_type: string | null
          jurisdiction: string
          last_activity_at: string | null
          last_error: string | null
          last_heartbeat_at: string | null
          last_worker_started_at: string | null
          lease_expires_at: string | null
          lease_heartbeat_at: string | null
          lease_worker_id: string | null
          metadata: Json
          next_attempt_at: string | null
          normalized_permit_number: string | null
          normalized_scope_key: string | null
          permit_number: string | null
          phase: string | null
          plan_review_state: string | null
          portal_type: string | null
          progress_current: number | null
          progress_total: number | null
          project_id: string
          project_info_state: string | null
          requested_at: string | null
          requested_scope: Json
          run_intent: string
          scrape_mode: string | null
          scraper_session_id: string | null
          started_at: string | null
          status: string
          tenant_id: string | null
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "scrape_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_project_milestone_invoice: {
        Args: { p_milestone: string; p_project_id: string }
        Returns: Json
      }
      claim_uci_graph_inbound_mailbox: {
        Args: {
          p_lease_ttl_seconds?: number
          p_owner: string
          p_user_id: string
        }
        Returns: {
          created_at: string
          last_cycle_metrics: Json
          last_poll_finished_at: string | null
          last_poll_started_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          updated_at: string
          user_id: string
          watermark_received_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "uci_graph_inbound_mailbox_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_uci_portal_sync_job: {
        Args: { p_lease_ttl_seconds?: number; p_worker_id: string }
        Returns: {
          attachments_state: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          canonical_job_id: string | null
          checkpoint_version: number
          completed_at: string | null
          coordination_record_id: string | null
          created_at: string
          credential_id: string | null
          current_stage: string | null
          current_user_message: string | null
          dispatch_priority: number
          error_code: string | null
          error_user_message: string | null
          explicitly_resumed_at: string | null
          id: string
          job_type: string | null
          jurisdiction: string
          last_activity_at: string | null
          last_error: string | null
          last_heartbeat_at: string | null
          last_worker_started_at: string | null
          lease_expires_at: string | null
          lease_heartbeat_at: string | null
          lease_worker_id: string | null
          metadata: Json
          next_attempt_at: string | null
          normalized_permit_number: string | null
          normalized_scope_key: string | null
          permit_number: string | null
          phase: string | null
          plan_review_state: string | null
          portal_type: string | null
          progress_current: number | null
          progress_total: number | null
          project_id: string
          project_info_state: string | null
          requested_at: string | null
          requested_scope: Json
          run_intent: string
          scrape_mode: string | null
          scraper_session_id: string | null
          started_at: string | null
          status: string
          tenant_id: string | null
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "scrape_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      copy_utility_provider_template_for_tenant: {
        Args: { p_template_slug: string; p_tenant_id: string }
        Returns: string
      }
      create_project_team_invitation: {
        Args: {
          p_email: string
          p_project_id: string
          p_role?: Database["public"]["Enums"]["team_role"]
        }
        Returns: Json
      }
      credential_has_grant: {
        Args: {
          p_credential_id: string
          p_min_level?: string
          p_user_id: string
        }
        Returns: boolean
      }
      decline_project_team_invitation: {
        Args: { p_accept_token: string }
        Returns: Json
      }
      enqueue_or_get_arlington_scrape_job: {
        Args: {
          p_credential_id: string
          p_metadata?: Json
          p_normalized_permit_number: string
          p_normalized_scope_key: string
          p_permit_number: string
          p_project_id: string
          p_requested_scope: Json
          p_scraper_session_id?: string
          p_user_id: string
        }
        Returns: {
          job: Database["public"]["Tables"]["scrape_jobs"]["Row"]
          reused_existing: boolean
        }[]
      }
      enqueue_or_get_uci_portal_sync_job: {
        Args: {
          p_coordination_record_id: string
          p_project_id: string
          p_provider_slug: string
          p_requested_scope?: Json
          p_user_id: string
        }
        Returns: {
          job: Database["public"]["Tables"]["scrape_jobs"]["Row"]
          reused_existing: boolean
        }[]
      }
      get_feature_flags: {
        Args: never
        Returns: {
          category: string
          description: string
          enabled: boolean
          key: string
          label: string
          updated_at: string
          updated_by: string
        }[]
      }
      get_jurisdiction_subscriber_list: {
        Args: { p_jurisdiction_id: string }
        Returns: {
          jurisdiction_id: string
          jurisdiction_name: string
          jurisdiction_state: string
          subscribed_at: string
          user_id: string
        }[]
      }
      get_jurisdiction_subscriber_summary: {
        Args: never
        Returns: {
          jurisdiction_id: string
          jurisdiction_name: string
          jurisdiction_state: string
          subscriber_count: number
        }[]
      }
      get_jurisdiction_subscription_count: {
        Args: { p_jurisdiction_id: string }
        Returns: number
      }
      has_project_access: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_project_admin_access: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_project_editor_access: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tenant_access: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      has_tenant_admin_access: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      has_tenant_project_access: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_tenant_project_editor_access: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_uci_row_access: {
        Args: { _project_id: string; _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      has_uci_row_editor_access: {
        Args: { _project_id: string; _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      heartbeat_arlington_scrape_job_lease: {
        Args: {
          p_job_id: string
          p_lease_ttl_seconds?: number
          p_worker_id: string
        }
        Returns: boolean
      }
      heartbeat_uci_portal_sync_job_lease: {
        Args: {
          p_job_id: string
          p_lease_ttl_seconds?: number
          p_worker_id: string
        }
        Returns: boolean
      }
      invoke_process_drip_emails: { Args: never; Returns: undefined }
      invoke_process_scheduled_notifications: {
        Args: never
        Returns: undefined
      }
      is_demo_tenant: { Args: { _tenant_id: string }; Returns: boolean }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_user_active: { Args: { p_user_id: string }; Returns: boolean }
      is_user_demo_only: { Args: { _user_id: string }; Returns: boolean }
      list_accessible_uci_projects: {
        Args: { _user_id: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      mark_project_invitation_email_sent: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      match_document_chunks: {
        Args: {
          p_match_count?: number
          p_project_id: string
          p_query_embedding: string
        }
        Returns: {
          chunk_text: string
          document_id: string
          document_type: string
          file_name: string
          id: string
          metadata: Json
          page_number: number
          sheet_label: string
          sheet_title: string
          similarity: number
        }[]
      }
      preview_project_team_invitation: {
        Args: { p_accept_token: string }
        Returns: Json
      }
      publish_scrape_event: {
        Args: {
          p_event_type: string
          p_is_heartbeat?: boolean
          p_job_id: string
          p_metadata?: Json
          p_progress_current?: number
          p_progress_total?: number
          p_project_id: string
          p_stage: string
          p_status: string
          p_technical_message?: string
          p_user_message: string
        }
        Returns: {
          created_at: string
          event_type: string
          id: string
          job_id: string
          metadata: Json
          progress_current: number | null
          progress_total: number | null
          project_id: string
          sequence: number
          stage: string | null
          status: string | null
          technical_message: string | null
          user_message: string
        }
        SetofOptions: {
          from: "*"
          to: "scrape_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_arlington_scrape_job_lease: {
        Args: {
          p_attachments_state?: string
          p_attempt_count?: number
          p_checkpoint_version?: number
          p_completed_at?: string
          p_current_stage?: string
          p_current_user_message?: string
          p_job_id: string
          p_last_error?: string
          p_next_attempt_at?: string
          p_phase?: string
          p_plan_review_state?: string
          p_project_info_state?: string
          p_status?: string
          p_worker_id: string
        }
        Returns: {
          attachments_state: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          canonical_job_id: string | null
          checkpoint_version: number
          completed_at: string | null
          coordination_record_id: string | null
          created_at: string
          credential_id: string | null
          current_stage: string | null
          current_user_message: string | null
          dispatch_priority: number
          error_code: string | null
          error_user_message: string | null
          explicitly_resumed_at: string | null
          id: string
          job_type: string | null
          jurisdiction: string
          last_activity_at: string | null
          last_error: string | null
          last_heartbeat_at: string | null
          last_worker_started_at: string | null
          lease_expires_at: string | null
          lease_heartbeat_at: string | null
          lease_worker_id: string | null
          metadata: Json
          next_attempt_at: string | null
          normalized_permit_number: string | null
          normalized_scope_key: string | null
          permit_number: string | null
          phase: string | null
          plan_review_state: string | null
          portal_type: string | null
          progress_current: number | null
          progress_total: number | null
          project_id: string
          project_info_state: string | null
          requested_at: string | null
          requested_scope: Json
          run_intent: string
          scrape_mode: string | null
          scraper_session_id: string | null
          started_at: string | null
          status: string
          tenant_id: string | null
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "scrape_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_uci_graph_inbound_mailbox: {
        Args: {
          p_metrics?: Json
          p_owner: string
          p_user_id: string
          p_watermark_received_at?: string
        }
        Returns: {
          created_at: string
          last_cycle_metrics: Json
          last_poll_finished_at: string | null
          last_poll_started_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          updated_at: string
          user_id: string
          watermark_received_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "uci_graph_inbound_mailbox_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_uci_portal_sync_job_lease: {
        Args: {
          p_attempt_count?: number
          p_completed_at?: string
          p_current_stage?: string
          p_current_user_message?: string
          p_error_code?: string
          p_error_user_message?: string
          p_job_id: string
          p_last_error?: string
          p_next_attempt_at?: string
          p_phase?: string
          p_status?: string
          p_worker_id: string
        }
        Returns: {
          attachments_state: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          canonical_job_id: string | null
          checkpoint_version: number
          completed_at: string | null
          coordination_record_id: string | null
          created_at: string
          credential_id: string | null
          current_stage: string | null
          current_user_message: string | null
          dispatch_priority: number
          error_code: string | null
          error_user_message: string | null
          explicitly_resumed_at: string | null
          id: string
          job_type: string | null
          jurisdiction: string
          last_activity_at: string | null
          last_error: string | null
          last_heartbeat_at: string | null
          last_worker_started_at: string | null
          lease_expires_at: string | null
          lease_heartbeat_at: string | null
          lease_worker_id: string | null
          metadata: Json
          next_attempt_at: string | null
          normalized_permit_number: string | null
          normalized_scope_key: string | null
          permit_number: string | null
          phase: string | null
          plan_review_state: string | null
          portal_type: string | null
          progress_current: number | null
          progress_total: number | null
          project_id: string
          project_info_state: string | null
          requested_at: string | null
          requested_scope: Json
          run_intent: string
          scrape_mode: string | null
          scraper_session_id: string | null
          started_at: string | null
          status: string
          tenant_id: string | null
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "scrape_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_arlington_job_dispatch: {
        Args: { p_job_id: string }
        Returns: {
          currently_running_job_id: string
          dispatch_priority: number
          job_id: string
          queue_position: number
          run_intent: string
        }[]
      }
      resend_project_team_invitation: {
        Args: { p_cooldown_seconds?: number; p_invitation_id: string }
        Returns: Json
      }
      revoke_project_team_invitation: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      set_feature_flag: {
        Args: { p_enabled: boolean; p_key: string }
        Returns: Json
      }
      unsubscribe_jurisdiction_emails: { Args: never; Returns: boolean }
      upsert_notification_preferences: {
        Args: { p_prefs: Json }
        Returns: {
          email_deadline_reminders: boolean
          email_inspection_reminders: boolean
          email_jurisdiction_updates: boolean
          email_project_updates: boolean
          inapp_jurisdiction_updates: boolean
          inapp_notifications: boolean
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notification_preferences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      activity_type:
        | "project_created"
        | "project_updated"
        | "project_status_changed"
        | "document_uploaded"
        | "document_version_uploaded"
        | "document_deleted"
        | "team_member_invited"
        | "team_member_joined"
        | "team_member_removed"
        | "team_member_role_changed"
        | "inspection_scheduled"
        | "inspection_updated"
        | "inspection_passed"
        | "inspection_failed"
        | "inspection_cancelled"
        | "punch_item_created"
        | "punch_item_updated"
        | "punch_item_resolved"
        | "punch_item_verified"
        | "comment_added"
      app_role: "admin" | "moderator" | "user" | "super_admin"
      document_type:
        | "permit_drawing"
        | "submittal_package"
        | "structural_calcs"
        | "site_plan"
        | "floor_plan"
        | "elevation"
        | "specification"
        | "inspection_report"
        | "correspondence"
        | "other"
        | "uci_closeout_package"
        | "load_calculation_worksheet"
        | "code_modification_application"
      epermit_status:
        | "pending"
        | "submitted"
        | "under_review"
        | "additional_info_required"
        | "approved"
        | "denied"
        | "cancelled"
        | "expired"
      epermit_system: "accela" | "cityview"
      inspection_status:
        | "scheduled"
        | "in_progress"
        | "passed"
        | "failed"
        | "conditional"
        | "cancelled"
      inspection_type:
        | "foundation"
        | "framing"
        | "electrical_rough"
        | "electrical_final"
        | "plumbing_rough"
        | "plumbing_final"
        | "mechanical_rough"
        | "mechanical_final"
        | "insulation"
        | "drywall"
        | "fire_safety"
        | "final"
        | "other"
      project_status:
        | "draft"
        | "submitted"
        | "in_review"
        | "corrections"
        | "approved"
      project_type:
        | "new_construction"
        | "renovation"
        | "addition"
        | "tenant_improvement"
        | "demolition"
        | "other"
      punch_list_priority: "low" | "medium" | "high" | "critical"
      punch_list_status: "open" | "in_progress" | "resolved" | "verified"
      team_role: "owner" | "admin" | "editor" | "viewer"
      tenant_membership_role: "owner" | "admin" | "member" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_type: [
        "project_created",
        "project_updated",
        "project_status_changed",
        "document_uploaded",
        "document_version_uploaded",
        "document_deleted",
        "team_member_invited",
        "team_member_joined",
        "team_member_removed",
        "team_member_role_changed",
        "inspection_scheduled",
        "inspection_updated",
        "inspection_passed",
        "inspection_failed",
        "inspection_cancelled",
        "punch_item_created",
        "punch_item_updated",
        "punch_item_resolved",
        "punch_item_verified",
        "comment_added",
      ],
      app_role: ["admin", "moderator", "user", "super_admin"],
      document_type: [
        "permit_drawing",
        "submittal_package",
        "structural_calcs",
        "site_plan",
        "floor_plan",
        "elevation",
        "specification",
        "inspection_report",
        "correspondence",
        "other",
        "uci_closeout_package",
        "load_calculation_worksheet",
        "code_modification_application",
      ],
      epermit_status: [
        "pending",
        "submitted",
        "under_review",
        "additional_info_required",
        "approved",
        "denied",
        "cancelled",
        "expired",
      ],
      epermit_system: ["accela", "cityview"],
      inspection_status: [
        "scheduled",
        "in_progress",
        "passed",
        "failed",
        "conditional",
        "cancelled",
      ],
      inspection_type: [
        "foundation",
        "framing",
        "electrical_rough",
        "electrical_final",
        "plumbing_rough",
        "plumbing_final",
        "mechanical_rough",
        "mechanical_final",
        "insulation",
        "drywall",
        "fire_safety",
        "final",
        "other",
      ],
      project_status: [
        "draft",
        "submitted",
        "in_review",
        "corrections",
        "approved",
      ],
      project_type: [
        "new_construction",
        "renovation",
        "addition",
        "tenant_improvement",
        "demolition",
        "other",
      ],
      punch_list_priority: ["low", "medium", "high", "critical"],
      punch_list_status: ["open", "in_progress", "resolved", "verified"],
      team_role: ["owner", "admin", "editor", "viewer"],
      tenant_membership_role: ["owner", "admin", "member", "viewer"],
    },
  },
} as const
