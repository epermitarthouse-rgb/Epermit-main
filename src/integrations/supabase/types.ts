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
    PostgrestVersion: "14.1"
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
          error_message: string | null
          id: string
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
          error_message?: string | null
          id?: string
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
          error_message?: string | null
          id?: string
          jurisdiction_id?: string | null
          jurisdiction_name?: string | null
          notification_message?: string | null
          notification_title?: string | null
          subscriber_count?: number | null
        }
        Relationships: []
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
        Relationships: []
      }
      jurisdictions: {
        Row: {
          accepted_file_formats: string[] | null
          address: string | null
          base_permit_fee: number | null
          city: string | null
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
          phone: string | null
          plan_review_fee: number | null
          plan_review_sla_days: number | null
          commercial_permits_2024: number | null
          total_permits_2024: number | null
          avg_review_days_actual: number | null
          avg_issuance_days_actual: number | null
          permit_portal_url: string | null
          residential_units_2024: number | null
          reviewer_contacts: Json | null
          sf_1unit_units_2024: number | null
          special_requirements: string | null
          state: string
          submission_methods: string[] | null
          updated_at: string
          verified_by: string | null
          website_url: string | null
        }
        Insert: {
          accepted_file_formats?: string[] | null
          address?: string | null
          base_permit_fee?: number | null
          city?: string | null
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
          phone?: string | null
          plan_review_fee?: number | null
          plan_review_sla_days?: number | null
          commercial_permits_2024?: number | null
          total_permits_2024?: number | null
          avg_review_days_actual?: number | null
          avg_issuance_days_actual?: number | null
          permit_portal_url?: string | null
          residential_units_2024?: number | null
          reviewer_contacts?: Json | null
          sf_1unit_units_2024?: number | null
          special_requirements?: string | null
          state: string
          submission_methods?: string[] | null
          updated_at?: string
          verified_by?: string | null
          website_url?: string | null
        }
        Update: {
          accepted_file_formats?: string[] | null
          address?: string | null
          base_permit_fee?: number | null
          city?: string | null
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
          phone?: string | null
          plan_review_fee?: number | null
          plan_review_sla_days?: number | null
          commercial_permits_2024?: number | null
          total_permits_2024?: number | null
          avg_review_days_actual?: number | null
          avg_issuance_days_actual?: number | null
          permit_portal_url?: string | null
          residential_units_2024?: number | null
          reviewer_contacts?: Json | null
          sf_1unit_units_2024?: number | null
          special_requirements?: string | null
          state?: string
          submission_methods?: string[] | null
          updated_at?: string
          verified_by?: string | null
          website_url?: string | null
        }
        Relationships: []
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
      profiles: {
        Row: {
          company_name: string | null
          created_at: string
          full_name: string | null
          id: string
          job_title: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          job_title?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          job_title?: string | null
          phone?: string | null
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
      project_documents: {
        Row: {
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
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          project_id: string
          role: Database["public"]["Enums"]["team_role"]
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          project_id: string
          role?: Database["public"]["Enums"]["team_role"]
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          project_id?: string
          role?: Database["public"]["Enums"]["team_role"]
          status?: string
          token?: string
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
          city: string | null
          created_at: string
          deadline: string | null
          description: string | null
          estimated_value: number | null
          expeditor_cost: number | null
          id: string
          jurisdiction: string | null
          name: string
          notes: string | null
          permit_fee: number | null
          permit_number: string | null
          project_type: Database["public"]["Enums"]["project_type"] | null
          rejection_count: number | null
          rejection_reasons: string[] | null
          square_footage: number | null
          state: string | null
          status: Database["public"]["Enums"]["project_status"]
          submitted_at: string | null
          total_cost: number | null
          updated_at: string
          user_id: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          approved_at?: string | null
          city?: string | null
          created_at?: string
          deadline?: string | null
          description?: string | null
          estimated_value?: number | null
          expeditor_cost?: number | null
          id?: string
          jurisdiction?: string | null
          name: string
          notes?: string | null
          permit_fee?: number | null
          permit_number?: string | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          rejection_count?: number | null
          rejection_reasons?: string[] | null
          square_footage?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          submitted_at?: string | null
          total_cost?: number | null
          updated_at?: string
          user_id: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          approved_at?: string | null
          city?: string | null
          created_at?: string
          deadline?: string | null
          description?: string | null
          estimated_value?: number | null
          expeditor_cost?: number | null
          id?: string
          jurisdiction?: string | null
          name?: string
          notes?: string | null
          permit_fee?: number | null
          permit_number?: string | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          rejection_count?: number | null
          rejection_reasons?: string[] | null
          square_footage?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          submitted_at?: string | null
          total_cost?: number | null
          updated_at?: string
          user_id?: string
          zip_code?: string | null
        }
        Relationships: []
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
          error_message: string | null
          id: string
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
          error_message?: string | null
          id?: string
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
          error_message?: string | null
          id?: string
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
      has_project_access: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_project_admin_access: {
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
      app_role: "admin" | "moderator" | "user"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
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
      app_role: ["admin", "moderator", "user"],
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
    },
  },
} as const
