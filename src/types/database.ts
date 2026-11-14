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
    PostgrestVersion: "14.18"
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
      ai_corrections: {
        Row: {
          after: Json
          before: Json
          created_at: string
          edited_by: string | null
          id: string
          order_id: string
          restaurant_id: string
          session_id: string | null
        }
        Insert: {
          after: Json
          before: Json
          created_at?: string
          edited_by?: string | null
          id?: string
          order_id: string
          restaurant_id: string
          session_id?: string | null
        }
        Update: {
          after?: Json
          before?: Json
          created_at?: string
          edited_by?: string | null
          id?: string
          order_id?: string
          restaurant_id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_corrections_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "kitchen_orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "ai_corrections_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "ai_corrections_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_corrections_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "bot_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_logs: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          created_at: string
          error: string | null
          error_type: string | null
          estimated_cost: number
          id: string
          input_text: string | null
          input_tokens: number
          latency_ms: number
          model: string | null
          output_tokens: number
          provider: string | null
          reply_text: string | null
          restaurant_id: string
          session_id: string | null
          tool_calls: Json
          type: string
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          created_at?: string
          error?: string | null
          error_type?: string | null
          estimated_cost?: number
          id?: string
          input_text?: string | null
          input_tokens?: number
          latency_ms?: number
          model?: string | null
          output_tokens?: number
          provider?: string | null
          reply_text?: string | null
          restaurant_id: string
          session_id?: string | null
          tool_calls?: Json
          type?: string
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          created_at?: string
          error?: string | null
          error_type?: string | null
          estimated_cost?: number
          id?: string
          input_text?: string | null
          input_tokens?: number
          latency_ms?: number
          model?: string | null
          output_tokens?: number
          provider?: string | null
          reply_text?: string | null
          restaurant_id?: string
          session_id?: string | null
          tool_calls?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_logs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "bot_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          new_data: Json | null
          old_data: Json | null
          restaurant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          restaurant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          restaurant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_sessions: {
        Row: {
          branch_id: string
          cart: Json
          cart_draft_id: string | null
          conversation_id: string | null
          created_at: string
          customer_id: string | null
          delivery_address_text: string | null
          delivery_area: string | null
          delivery_landmark: string | null
          delivery_zone: Json | null
          failed_attempts: number
          handoff_reason: string | null
          id: string
          language: string
          last_activity_at: string
          latitude: number | null
          location_requested: boolean
          longitude: number | null
          order_id: string | null
          order_type: string | null
          payment_method: string | null
          pending_cart_code: string | null
          restaurant_id: string
          stage: string
          status: string
          summary_hash: string | null
          transcript: Json
          updated_at: string
        }
        Insert: {
          branch_id: string
          cart?: Json
          cart_draft_id?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          delivery_address_text?: string | null
          delivery_area?: string | null
          delivery_landmark?: string | null
          delivery_zone?: Json | null
          failed_attempts?: number
          handoff_reason?: string | null
          id?: string
          language?: string
          last_activity_at?: string
          latitude?: number | null
          location_requested?: boolean
          longitude?: number | null
          order_id?: string | null
          order_type?: string | null
          payment_method?: string | null
          pending_cart_code?: string | null
          restaurant_id: string
          stage?: string
          status?: string
          summary_hash?: string | null
          transcript?: Json
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cart?: Json
          cart_draft_id?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          delivery_address_text?: string | null
          delivery_area?: string | null
          delivery_landmark?: string | null
          delivery_zone?: Json | null
          failed_attempts?: number
          handoff_reason?: string | null
          id?: string
          language?: string
          last_activity_at?: string
          latitude?: number | null
          location_requested?: boolean
          longitude?: number | null
          order_id?: string | null
          order_type?: string | null
          payment_method?: string | null
          pending_cart_code?: string | null
          restaurant_id?: string
          stage?: string
          status?: string
          summary_hash?: string | null
          transcript?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_sessions_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "bot_sessions_cart_draft_id_fkey"
            columns: ["cart_draft_id"]
            isOneToOne: false
            referencedRelation: "cart_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_sessions_conversation_id_restaurant_id_fkey"
            columns: ["conversation_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "bot_sessions_customer_id_restaurant_id_fkey"
            columns: ["customer_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "bot_sessions_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "kitchen_orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "bot_sessions_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "bot_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_item_settings: {
        Row: {
          branch_id: string
          is_available: boolean
          is_hidden: boolean
          item_id: string
          price_override: number | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          is_available?: boolean
          is_hidden?: boolean
          item_id: string
          price_override?: number | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          is_available?: boolean
          is_hidden?: boolean
          item_id?: string
          price_override?: number | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_item_settings_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "branch_item_settings_item_id_restaurant_id_fkey"
            columns: ["item_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "branch_item_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_variant_prices: {
        Row: {
          branch_id: string
          price: number
          restaurant_id: string
          updated_at: string
          variant_id: string
        }
        Insert: {
          branch_id: string
          price: number
          restaurant_id: string
          updated_at?: string
          variant_id: string
        }
        Update: {
          branch_id?: string
          price?: number
          restaurant_id?: string
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_variant_prices_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "branch_variant_prices_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_variant_prices_variant_id_restaurant_id_fkey"
            columns: ["variant_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "item_variants"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      branches: {
        Row: {
          accept_alert_minutes: number
          address: string | null
          area: string | null
          auto_accept_orders: boolean
          city: string | null
          created_at: string
          default_delivery_fee: number
          default_prep_minutes: number
          delivery_minutes: number
          google_maps_url: string | null
          id: string
          is_active: boolean
          is_open: boolean
          late_order_minutes: number
          latitude: number | null
          longitude: number | null
          max_delivery_radius_km: number | null
          minimum_order: number
          name: string
          opening_hours: Json | null
          phone: string | null
          restaurant_id: string
          staff_orders_need_acceptance: boolean
          unlisted_area_policy: string
          updated_at: string
        }
        Insert: {
          accept_alert_minutes?: number
          address?: string | null
          area?: string | null
          auto_accept_orders?: boolean
          city?: string | null
          created_at?: string
          default_delivery_fee?: number
          default_prep_minutes?: number
          delivery_minutes?: number
          google_maps_url?: string | null
          id?: string
          is_active?: boolean
          is_open?: boolean
          late_order_minutes?: number
          latitude?: number | null
          longitude?: number | null
          max_delivery_radius_km?: number | null
          minimum_order?: number
          name: string
          opening_hours?: Json | null
          phone?: string | null
          restaurant_id: string
          staff_orders_need_acceptance?: boolean
          unlisted_area_policy?: string
          updated_at?: string
        }
        Update: {
          accept_alert_minutes?: number
          address?: string | null
          area?: string | null
          auto_accept_orders?: boolean
          city?: string | null
          created_at?: string
          default_delivery_fee?: number
          default_prep_minutes?: number
          delivery_minutes?: number
          google_maps_url?: string | null
          id?: string
          is_active?: boolean
          is_open?: boolean
          late_order_minutes?: number
          latitude?: number | null
          longitude?: number | null
          max_delivery_radius_km?: number | null
          minimum_order?: number
          name?: string
          opening_hours?: Json | null
          phone?: string | null
          restaurant_id?: string
          staff_orders_need_acceptance?: boolean
          unlisted_area_policy?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_drafts: {
        Row: {
          branch_id: string
          code: string
          created_at: string
          created_ip_hash: string | null
          expires_at: string
          id: string
          language: string
          lines: Json
          order_type: string | null
          restaurant_id: string
          session_id: string | null
          used_at: string | null
          used_by_customer_id: string | null
        }
        Insert: {
          branch_id: string
          code: string
          created_at?: string
          created_ip_hash?: string | null
          expires_at?: string
          id?: string
          language?: string
          lines: Json
          order_type?: string | null
          restaurant_id: string
          session_id?: string | null
          used_at?: string | null
          used_by_customer_id?: string | null
        }
        Update: {
          branch_id?: string
          code?: string
          created_at?: string
          created_ip_hash?: string | null
          expires_at?: string
          id?: string
          language?: string
          lines?: Json
          order_type?: string | null
          restaurant_id?: string
          session_id?: string | null
          used_at?: string | null
          used_by_customer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_drafts_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "cart_drafts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_drafts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "bot_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_drafts_used_by_customer_id_restaurant_id_fkey"
            columns: ["used_by_customer_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      conversation_notes: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          restaurant_id: string
          user_id: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          restaurant_id: string
          user_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          restaurant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_notes_conversation_id_restaurant_id_fkey"
            columns: ["conversation_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "conversation_notes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          address_text: string
          area: string | null
          created_at: string
          customer_id: string
          id: string
          is_default: boolean
          label: string | null
          landmark: string | null
          latitude: number | null
          longitude: number | null
          restaurant_id: string
        }
        Insert: {
          address_text: string
          area?: string | null
          created_at?: string
          customer_id: string
          id?: string
          is_default?: boolean
          label?: string | null
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          restaurant_id: string
        }
        Update: {
          address_text?: string
          area?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          is_default?: boolean
          label?: string | null
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_restaurant_id_fkey"
            columns: ["customer_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "customer_addresses_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          blocked_reason: string | null
          cancelled_count: number
          created_at: string
          id: string
          is_blocked: boolean
          last_order_at: string | null
          marketing_opt_in: boolean
          name: string | null
          notes: string | null
          phone: string
          preferred_language: string | null
          refused_count: number
          restaurant_id: string
          tags: string[]
          total_orders: number
          total_spent: number
          updated_at: string
          whatsapp_id: string | null
        }
        Insert: {
          blocked_reason?: string | null
          cancelled_count?: number
          created_at?: string
          id?: string
          is_blocked?: boolean
          last_order_at?: string | null
          marketing_opt_in?: boolean
          name?: string | null
          notes?: string | null
          phone: string
          preferred_language?: string | null
          refused_count?: number
          restaurant_id: string
          tags?: string[]
          total_orders?: number
          total_spent?: number
          updated_at?: string
          whatsapp_id?: string | null
        }
        Update: {
          blocked_reason?: string | null
          cancelled_count?: number
          created_at?: string
          id?: string
          is_blocked?: boolean
          last_order_at?: string | null
          marketing_opt_in?: boolean
          name?: string | null
          notes?: string | null
          phone?: string
          preferred_language?: string | null
          refused_count?: number
          restaurant_id?: string
          tags?: string[]
          total_orders?: number
          total_spent?: number
          updated_at?: string
          whatsapp_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_zones: {
        Row: {
          aliases: string[]
          branch_id: string
          created_at: string
          delivery_fee: number
          estimated_minutes: number | null
          id: string
          is_active: boolean
          minimum_order: number
          name: string
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          branch_id: string
          created_at?: string
          delivery_fee?: number
          estimated_minutes?: number | null
          id?: string
          is_active?: boolean
          minimum_order?: number
          name: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          branch_id?: string
          created_at?: string
          delivery_fee?: number
          estimated_minutes?: number | null
          id?: string
          is_active?: boolean
          minimum_order?: number
          name?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zones_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "delivery_zones_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      item_modifier_groups: {
        Row: {
          group_id: string
          item_id: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          group_id: string
          item_id: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          group_id?: string
          item_id?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_modifier_groups_group_id_restaurant_id_fkey"
            columns: ["group_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "item_modifier_groups_item_id_restaurant_id_fkey"
            columns: ["item_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "item_modifier_groups_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      item_variants: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          item_id: string
          name: string
          name_ur: string | null
          price: number
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          item_id: string
          name: string
          name_ur?: string | null
          price: number
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          item_id?: string
          name?: string
          name_ur?: string | null
          price?: number
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_variants_item_id_restaurant_id_fkey"
            columns: ["item_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "item_variants_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          job: string
          last_error: string | null
          last_ok: boolean
          last_result: Json
          last_run_at: string
          run_count: number
        }
        Insert: {
          job: string
          last_error?: string | null
          last_ok?: boolean
          last_result?: Json
          last_run_at?: string
          run_count?: number
        }
        Update: {
          job?: string
          last_error?: string | null
          last_ok?: boolean
          last_result?: Json
          last_run_at?: string
          run_count?: number
        }
        Relationships: []
      }
      memberships: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          is_active: boolean
          restaurant_id: string
          role: Database["public"]["Enums"]["member_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          restaurant_id: string
          role: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          restaurant_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "memberships_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          name_ur: string | null
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          name_ur?: string | null
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          name_ur?: string | null
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          aliases: string[]
          archived_at: string | null
          base_price: number | null
          category_id: string
          created_at: string
          description: string | null
          description_ur: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          name_ur: string | null
          prep_time_minutes: number | null
          removable_options: string[]
          restaurant_id: string
          sort_order: number
          tags: string[]
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          archived_at?: string | null
          base_price?: number | null
          category_id: string
          created_at?: string
          description?: string | null
          description_ur?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          name_ur?: string | null
          prep_time_minutes?: number | null
          removable_options?: string[]
          restaurant_id: string
          sort_order?: number
          tags?: string[]
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          archived_at?: string | null
          base_price?: number | null
          category_id?: string
          created_at?: string
          description?: string | null
          description_ur?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          name_ur?: string | null
          prep_time_minutes?: number | null
          removable_options?: string[]
          restaurant_id?: string
          sort_order?: number
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_restaurant_id_fkey"
            columns: ["category_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_media: {
        Row: {
          branch_id: string | null
          file_name: string | null
          id: string
          is_active: boolean
          restaurant_id: string
          size_bytes: number | null
          sort_order: number
          storage_path: string
          type: string
          updated_at: string
          uploaded_at: string
        }
        Insert: {
          branch_id?: string | null
          file_name?: string | null
          id?: string
          is_active?: boolean
          restaurant_id: string
          size_bytes?: number | null
          sort_order?: number
          storage_path: string
          type: string
          updated_at?: string
          uploaded_at?: string
        }
        Update: {
          branch_id?: string | null
          file_name?: string | null
          id?: string
          is_active?: boolean
          restaurant_id?: string
          size_bytes?: number | null
          sort_order?: number
          storage_path?: string
          type?: string
          updated_at?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_media_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "menu_media_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_page_views: {
        Row: {
          branch_id: string
          day: string
          restaurant_id: string
          views: number
        }
        Insert: {
          branch_id: string
          day: string
          restaurant_id: string
          views?: number
        }
        Update: {
          branch_id?: string
          day?: string
          restaurant_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_page_views_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "menu_page_views_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          max_select: number
          min_select: number
          name: string
          name_ur: string | null
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          max_select?: number
          min_select?: number
          name: string
          name_ur?: string | null
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          max_select?: number
          min_select?: number
          name?: string
          name_ur?: string | null
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_groups_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_options: {
        Row: {
          archived_at: string | null
          created_at: string
          group_id: string
          id: string
          is_available: boolean
          is_default: boolean
          name: string
          name_ur: string | null
          price_delta: number
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          group_id: string
          id?: string
          is_available?: boolean
          is_default?: boolean
          name: string
          name_ur?: string | null
          price_delta?: number
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          group_id?: string
          id?: string
          is_available?: boolean
          is_default?: boolean
          name?: string
          name_ur?: string | null
          price_delta?: number
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_options_group_id_restaurant_id_fkey"
            columns: ["group_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "modifier_options_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          branch_id: string | null
          created_at: string
          days_of_week: number[] | null
          description: string | null
          end_time: string | null
          ends_at: string | null
          id: string
          image_path: string | null
          is_active: boolean
          menu_item_id: string
          restaurant_id: string
          sort_order: number
          start_time: string | null
          starts_at: string
          title: string
          title_ur: string | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          days_of_week?: number[] | null
          description?: string | null
          end_time?: string | null
          ends_at?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          menu_item_id: string
          restaurant_id: string
          sort_order?: number
          start_time?: string | null
          starts_at?: string
          title: string
          title_ur?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          days_of_week?: number[] | null
          description?: string | null
          end_time?: string | null
          ends_at?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          menu_item_id?: string
          restaurant_id?: string
          sort_order?: number
          start_time?: string | null
          starts_at?: string
          title?: string
          title_ur?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "offers_menu_item_id_restaurant_id_fkey"
            columns: ["menu_item_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "offers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_counters: {
        Row: {
          last_number: number
          restaurant_id: string
        }
        Insert: {
          last_number?: number
          restaurant_id: string
        }
        Update: {
          last_number?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_counters_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_type: Database["public"]["Enums"]["actor_type"]
          actor_user_id: string | null
          created_at: string
          data: Json
          event_type: Database["public"]["Enums"]["order_event_type"]
          from_status: Database["public"]["Enums"]["order_status"] | null
          id: number
          order_id: string
          restaurant_id: string
          to_status: Database["public"]["Enums"]["order_status"] | null
        }
        Insert: {
          actor_type: Database["public"]["Enums"]["actor_type"]
          actor_user_id?: string | null
          created_at?: string
          data?: Json
          event_type: Database["public"]["Enums"]["order_event_type"]
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: never
          order_id: string
          restaurant_id: string
          to_status?: Database["public"]["Enums"]["order_status"] | null
        }
        Update: {
          actor_type?: Database["public"]["Enums"]["actor_type"]
          actor_user_id?: string | null
          created_at?: string
          data?: Json
          event_type?: Database["public"]["Enums"]["order_event_type"]
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: never
          order_id?: string
          restaurant_id?: string
          to_status?: Database["public"]["Enums"]["order_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "kitchen_orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_events_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_modifiers: {
        Row: {
          group_name: string
          id: string
          option_id: string | null
          option_name: string
          order_item_id: string
          price_delta: number
          restaurant_id: string
        }
        Insert: {
          group_name: string
          id?: string
          option_id?: string | null
          option_name: string
          order_item_id: string
          price_delta: number
          restaurant_id: string
        }
        Update: {
          group_name?: string
          id?: string
          option_id?: string | null
          option_name?: string
          order_item_id?: string
          price_delta?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_order_item_id_restaurant_id_fkey"
            columns: ["order_item_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_item_modifiers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          is_cancelled: boolean
          item_id: string
          item_name: string
          line_total: number
          notes: string | null
          order_id: string
          quantity: number
          removals: string[]
          restaurant_id: string
          size_name: string | null
          snapshot: Json
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_cancelled?: boolean
          item_id: string
          item_name: string
          line_total: number
          notes?: string | null
          order_id: string
          quantity: number
          removals?: string[]
          restaurant_id: string
          size_name?: string | null
          snapshot: Json
          unit_price: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_cancelled?: boolean
          item_id?: string
          item_name?: string
          line_total?: number
          notes?: string | null
          order_id?: string
          quantity?: number
          removals?: string[]
          restaurant_id?: string
          size_name?: string | null
          snapshot?: Json
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "kitchen_orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_items_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          accepted_at: string | null
          address_text: string | null
          area: string | null
          assigned_at: string | null
          branch_id: string
          cancel_note: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cod_collected_amount: number | null
          cod_collected_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          delivered_at: string | null
          delivery_failed_reason: string | null
          delivery_fee: number
          delivery_zone_id: string | null
          discount: number
          dispatched_at: string | null
          expected_ready_at: string | null
          failed_at: string | null
          hold_reason: string | null
          id: string
          idempotency_key: string | null
          is_on_hold: boolean
          landmark: string | null
          latitude: number | null
          longitude: number | null
          notes: string | null
          order_number: number
          order_type: Database["public"]["Enums"]["order_type"]
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          preparing_at: string | null
          ready_at: string | null
          restaurant_id: string
          rider_id: string | null
          risk_flag: string | null
          scheduled_for: string | null
          service_charge: number
          settlement_id: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          table_number: string | null
          tax: number
          total: number
          updated_at: string
          version: number
        }
        Insert: {
          accepted_at?: string | null
          address_text?: string | null
          area?: string | null
          assigned_at?: string | null
          branch_id: string
          cancel_note?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cod_collected_amount?: number | null
          cod_collected_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_failed_reason?: string | null
          delivery_fee?: number
          delivery_zone_id?: string | null
          discount?: number
          dispatched_at?: string | null
          expected_ready_at?: string | null
          failed_at?: string | null
          hold_reason?: string | null
          id?: string
          idempotency_key?: string | null
          is_on_hold?: boolean
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          order_number: number
          order_type: Database["public"]["Enums"]["order_type"]
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          preparing_at?: string | null
          ready_at?: string | null
          restaurant_id: string
          rider_id?: string | null
          risk_flag?: string | null
          scheduled_for?: string | null
          service_charge?: number
          settlement_id?: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          table_number?: string | null
          tax?: number
          total: number
          updated_at?: string
          version?: number
        }
        Update: {
          accepted_at?: string | null
          address_text?: string | null
          area?: string | null
          assigned_at?: string | null
          branch_id?: string
          cancel_note?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cod_collected_amount?: number | null
          cod_collected_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_failed_reason?: string | null
          delivery_fee?: number
          delivery_zone_id?: string | null
          discount?: number
          dispatched_at?: string | null
          expected_ready_at?: string | null
          failed_at?: string | null
          hold_reason?: string | null
          id?: string
          idempotency_key?: string | null
          is_on_hold?: boolean
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          order_number?: number
          order_type?: Database["public"]["Enums"]["order_type"]
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          preparing_at?: string | null
          ready_at?: string | null
          restaurant_id?: string
          rider_id?: string | null
          risk_flag?: string | null
          scheduled_for?: string | null
          service_charge?: number
          settlement_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          table_number?: string | null
          tax?: number
          total?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "orders_customer_id_restaurant_id_fkey"
            columns: ["customer_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "orders_delivery_zone_fk"
            columns: ["delivery_zone_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_rider_fk"
            columns: ["rider_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "orders_settlement_fk"
            columns: ["settlement_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "rider_settlements"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          reference: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["payment_status"]
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          reference?: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["payment_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          order_id?: string
          reference?: string | null
          restaurant_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "kitchen_orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "payments_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          max_bot_conversations_per_month: number | null
          max_branches: number
          max_orders_per_month: number | null
          monthly_price: number
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          max_bot_conversations_per_month?: number | null
          max_branches?: number
          max_orders_per_month?: number | null
          monthly_price: number
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          max_bot_conversations_per_month?: number | null
          max_branches?: number
          max_orders_per_month?: number | null
          monthly_price?: number
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          default_trial_days: number
          grace_period_days: number
          id: boolean
          payment_instructions: string | null
          sales_whatsapp: string | null
          support_phone: string | null
          updated_at: string
        }
        Insert: {
          default_trial_days?: number
          grace_period_days?: number
          id?: boolean
          payment_instructions?: string | null
          sales_whatsapp?: string | null
          support_phone?: string | null
          updated_at?: string
        }
        Update: {
          default_trial_days?: number
          grace_period_days?: number
          id?: boolean
          payment_instructions?: string | null
          sales_whatsapp?: string | null
          support_phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          is_super_admin: boolean
          must_change_password: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          is_super_admin?: boolean
          must_change_password?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_super_admin?: boolean
          must_change_password?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          created_at: string
          id: string
          restaurant_id: string
          shortcut: string
          sort_order: number
          text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          restaurant_id: string
          shortcut: string
          sort_order?: number
          text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          restaurant_id?: string
          shortcut?: string
          sort_order?: number
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      restaurant_faqs: {
        Row: {
          answer: string
          answer_ur: string | null
          created_at: string
          id: string
          is_active: boolean
          keywords: string[]
          question: string
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer?: string
          answer_ur?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          question: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer?: string
          answer_ur?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          question?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_faqs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          notes: string | null
          past_due_since: string | null
          plan_id: string | null
          restaurant_id: string
          status: string
          suspended_at: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          notes?: string | null
          past_due_since?: string | null
          plan_id?: string | null
          restaurant_id: string
          status?: string
          suspended_at?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          notes?: string | null
          past_due_since?: string | null
          plan_id?: string | null
          restaurant_id?: string
          status?: string
          suspended_at?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_subscriptions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          ai_monthly_budget_usd: number | null
          auto_resolve_hours: number
          bill_footer: string | null
          bill_header: string | null
          bot_enabled: boolean
          city: string | null
          created_at: string
          created_by: string | null
          currency: string
          dine_in_available: boolean
          high_value_cod_threshold: number
          id: string
          logo_url: string | null
          mention_offer_on_greeting: boolean
          name: string
          needs_staff_alert_minutes: number
          payment_methods: string[]
          phone: string | null
          receipt_paper_width: string
          share_rider_phone_with_customer: boolean
          slug: string
          status: Database["public"]["Enums"]["restaurant_status"]
          timezone: string
          trial_ends_at: string | null
          updated_at: string
          whatsapp_number: string | null
          whatsapp_status_messages: Json
        }
        Insert: {
          ai_monthly_budget_usd?: number | null
          auto_resolve_hours?: number
          bill_footer?: string | null
          bill_header?: string | null
          bot_enabled?: boolean
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dine_in_available?: boolean
          high_value_cod_threshold?: number
          id?: string
          logo_url?: string | null
          mention_offer_on_greeting?: boolean
          name: string
          needs_staff_alert_minutes?: number
          payment_methods?: string[]
          phone?: string | null
          receipt_paper_width?: string
          share_rider_phone_with_customer?: boolean
          slug: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          timezone?: string
          trial_ends_at?: string | null
          updated_at?: string
          whatsapp_number?: string | null
          whatsapp_status_messages?: Json
        }
        Update: {
          ai_monthly_budget_usd?: number | null
          auto_resolve_hours?: number
          bill_footer?: string | null
          bill_header?: string | null
          bot_enabled?: boolean
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dine_in_available?: boolean
          high_value_cod_threshold?: number
          id?: string
          logo_url?: string | null
          mention_offer_on_greeting?: boolean
          name?: string
          needs_staff_alert_minutes?: number
          payment_methods?: string[]
          phone?: string | null
          receipt_paper_width?: string
          share_rider_phone_with_customer?: boolean
          slug?: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          timezone?: string
          trial_ends_at?: string | null
          updated_at?: string
          whatsapp_number?: string | null
          whatsapp_status_messages?: Json
        }
        Relationships: []
      }
      rider_login_attempts: {
        Row: {
          failed_count: number
          locked_until: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          failed_count?: number
          locked_until?: string | null
          phone: string
          updated_at?: string
        }
        Update: {
          failed_count?: number
          locked_until?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      rider_profiles: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          is_active: boolean
          is_online: boolean
          name: string
          phone: string
          restaurant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_online?: boolean
          name: string
          phone: string
          restaurant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_online?: boolean
          name?: string
          phone?: string
          restaurant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_profiles_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "rider_profiles_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_settlements: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          expected_amount: number
          id: string
          notes: string | null
          order_ids: string[]
          restaurant_id: string
          rider_id: string
          settled_by: string | null
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          expected_amount: number
          id?: string
          notes?: string | null
          order_ids: string[]
          restaurant_id: string
          rider_id: string
          settled_by?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          expected_amount?: number
          id?: string
          notes?: string | null
          order_ids?: string[]
          restaurant_id?: string
          rider_id?: string
          settled_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_settlements_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "rider_settlements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_settlements_rider_id_restaurant_id_fkey"
            columns: ["rider_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      subscription_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          notes: string | null
          period_end: string
          period_start: string
          plan_id: string | null
          receipt_number: number
          recorded_by: string | null
          reference: string | null
          restaurant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method: string
          notes?: string | null
          period_end: string
          period_start: string
          plan_id?: string | null
          receipt_number?: never
          recorded_by?: string | null
          reference?: string | null
          restaurant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          plan_id?: string | null
          receipt_number?: never
          recorded_by?: string | null
          reference?: string | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_accounts: {
        Row: {
          access_token_encrypted: string
          branch_id: string | null
          connected_at: string
          created_at: string
          display_phone_number: string
          id: string
          is_active: boolean
          phone_number_id: string
          restaurant_id: string
          updated_at: string
          waba_id: string
        }
        Insert: {
          access_token_encrypted: string
          branch_id?: string | null
          connected_at?: string
          created_at?: string
          display_phone_number: string
          id?: string
          is_active?: boolean
          phone_number_id: string
          restaurant_id: string
          updated_at?: string
          waba_id: string
        }
        Update: {
          access_token_encrypted?: string
          branch_id?: string | null
          connected_at?: string
          created_at?: string
          display_phone_number?: string
          id?: string
          is_active?: boolean
          phone_number_id?: string
          restaurant_id?: string
          updated_at?: string
          waba_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_accounts_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "whatsapp_accounts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          assigned_to: string | null
          bot_enabled: boolean
          bot_lock_until: string | null
          bot_muted_until: string | null
          created_at: string
          customer_id: string | null
          handed_off_at: string | null
          handoff_reason: string | null
          id: string
          last_auto_reply_at: string | null
          last_customer_message_at: string | null
          last_message_at: string | null
          last_message_preview: string | null
          needs_staff: boolean
          needs_staff_since: string | null
          resolved_at: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["wa_conversation_status"]
          suspended_notice_at: string | null
          tags: string[]
          unread_count: number
          updated_at: string
          wa_id: string
        }
        Insert: {
          assigned_to?: string | null
          bot_enabled?: boolean
          bot_lock_until?: string | null
          bot_muted_until?: string | null
          created_at?: string
          customer_id?: string | null
          handed_off_at?: string | null
          handoff_reason?: string | null
          id?: string
          last_auto_reply_at?: string | null
          last_customer_message_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          needs_staff?: boolean
          needs_staff_since?: string | null
          resolved_at?: string | null
          restaurant_id: string
          status?: Database["public"]["Enums"]["wa_conversation_status"]
          suspended_notice_at?: string | null
          tags?: string[]
          unread_count?: number
          updated_at?: string
          wa_id: string
        }
        Update: {
          assigned_to?: string | null
          bot_enabled?: boolean
          bot_lock_until?: string | null
          bot_muted_until?: string | null
          created_at?: string
          customer_id?: string | null
          handed_off_at?: string | null
          handoff_reason?: string | null
          id?: string
          last_auto_reply_at?: string | null
          last_customer_message_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          needs_staff?: boolean
          needs_staff_since?: string | null
          resolved_at?: string | null
          restaurant_id?: string
          status?: Database["public"]["Enums"]["wa_conversation_status"]
          suspended_notice_at?: string | null
          tags?: string[]
          unread_count?: number
          updated_at?: string
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_customer_id_restaurant_id_fkey"
            columns: ["customer_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          body: string | null
          bot_handled_at: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["wa_direction"]
          error: string | null
          id: string
          media_id: string | null
          media_mime_type: string | null
          media_size: number | null
          media_url: string | null
          order_id: string | null
          raw: Json | null
          restaurant_id: string
          sender_type: string
          sent_by_user_id: string | null
          status: Database["public"]["Enums"]["wa_message_status"]
          transcribe_provider: string | null
          transcript: string | null
          type: Database["public"]["Enums"]["wa_message_type"]
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          body?: string | null
          bot_handled_at?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["wa_direction"]
          error?: string | null
          id?: string
          media_id?: string | null
          media_mime_type?: string | null
          media_size?: number | null
          media_url?: string | null
          order_id?: string | null
          raw?: Json | null
          restaurant_id: string
          sender_type?: string
          sent_by_user_id?: string | null
          status: Database["public"]["Enums"]["wa_message_status"]
          transcribe_provider?: string | null
          transcript?: string | null
          type?: Database["public"]["Enums"]["wa_message_type"]
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          body?: string | null
          bot_handled_at?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["wa_direction"]
          error?: string | null
          id?: string
          media_id?: string | null
          media_mime_type?: string | null
          media_size?: number | null
          media_url?: string | null
          order_id?: string | null
          raw?: Json | null
          restaurant_id?: string
          sender_type?: string
          sent_by_user_id?: string | null
          status?: Database["public"]["Enums"]["wa_message_status"]
          transcribe_provider?: string | null
          transcript?: string | null
          type?: Database["public"]["Enums"]["wa_message_type"]
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_restaurant_id_fkey"
            columns: ["conversation_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_order_fk"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "kitchen_orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_order_fk"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_webhook_events: {
        Row: {
          error: string | null
          id: number
          processed_at: string | null
          raw: Json
          received_at: string
        }
        Insert: {
          error?: string | null
          id?: never
          processed_at?: string | null
          raw: Json
          received_at?: string
        }
        Update: {
          error?: string | null
          id?: never
          processed_at?: string | null
          raw?: Json
          received_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      kitchen_orders: {
        Row: {
          accepted_at: string | null
          branch_id: string | null
          cancelled_at: string | null
          created_at: string | null
          customer_name: string | null
          expected_ready_at: string | null
          hold_reason: string | null
          id: string | null
          is_on_hold: boolean | null
          notes: string | null
          order_number: number | null
          order_type: Database["public"]["Enums"]["order_type"] | null
          preparing_at: string | null
          ready_at: string | null
          restaurant_id: string | null
          scheduled_for: string | null
          source: Database["public"]["Enums"]["order_source"] | null
          status: Database["public"]["Enums"]["order_status"] | null
          table_number: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          accepted_at?: string | null
          branch_id?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          customer_name?: string | null
          expected_ready_at?: string | null
          hold_reason?: string | null
          id?: string | null
          is_on_hold?: boolean | null
          notes?: string | null
          order_number?: number | null
          order_type?: Database["public"]["Enums"]["order_type"] | null
          preparing_at?: string | null
          ready_at?: string | null
          restaurant_id?: string | null
          scheduled_for?: string | null
          source?: Database["public"]["Enums"]["order_source"] | null
          status?: Database["public"]["Enums"]["order_status"] | null
          table_number?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          accepted_at?: string | null
          branch_id?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          customer_name?: string | null
          expected_ready_at?: string | null
          hold_reason?: string | null
          id?: string | null
          is_on_hold?: boolean | null
          notes?: string | null
          order_number?: number | null
          order_type?: Database["public"]["Enums"]["order_type"] | null
          preparing_at?: string | null
          ready_at?: string | null
          restaurant_id?: string | null
          scheduled_for?: string | null
          source?: Database["public"]["Enums"]["order_source"] | null
          status?: Database["public"]["Enums"]["order_status"] | null
          table_number?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_create_restaurant: {
        Args: {
          p_branch_name: string
          p_city: string
          p_created_by: string
          p_name: string
          p_owner_id: string
          p_phone: string
          p_plan_id: string
          p_slug: string
          p_trial_days: number
        }
        Returns: string
      }
      admin_record_subscription_payment: {
        Args: {
          p_amount: number
          p_method: string
          p_notes: string
          p_recorded_by: string
          p_reference: string
          p_restaurant_id: string
        }
        Returns: string
      }
      admin_restaurant_usage: {
        Args: { p_month_start: string }
        Returns: {
          bot_conversations_this_month: number
          branches: number
          last_order_at: string
          orders_this_month: number
          restaurant_id: string
        }[]
      }
      ai_usage_summary: {
        Args: { p_restaurant_id?: string; p_since: string }
        Returns: {
          bot_orders: number
          conversations: number
          cost: number
          input_tokens: number
          output_tokens: number
          restaurant_id: string
        }[]
      }
      apply_price_changes: {
        Args: { p_audit: Json; p_changes: Json; p_restaurant_id: string }
        Returns: number
      }
      assign_order_rider: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_order_id: string
          p_restaurant_id: string
          p_rider_id: string
        }
        Returns: Json
      }
      bot_bestsellers: {
        Args: {
          p_branch_id: string
          p_limit?: number
          p_restaurant_id: string
          p_since: string
        }
        Returns: {
          item_id: string
          quantity: number
        }[]
      }
      bot_claim_conversation: {
        Args: { p_conversation_id: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      create_order: { Args: { p: Json }; Returns: Json }
      create_restaurant_with_owner: {
        Args: {
          p_branch_address: string
          p_branch_area: string
          p_branch_name: string
          p_city: string
          p_name: string
          p_opening_hours: Json
          p_phone: string
          p_slug: string
        }
        Returns: string
      }
      delete_customer_data: {
        Args: { p_customer_id: string; p_restaurant_id: string }
        Returns: Json
      }
      edit_order: { Args: { p: Json }; Returns: Json }
      get_public_menu: {
        Args: { p_branch_id: string; p_restaurant_slug: string }
        Returns: Json
      }
      get_public_menu_info: {
        Args: { p_branch_id?: string; p_slug: string }
        Returns: Json
      }
      inbox_auto_resolve: { Args: { p_restaurant_id: string }; Returns: number }
      is_slug_available: { Args: { p_slug: string }; Returns: boolean }
      rate_limit_hit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      record_app_job: {
        Args: {
          p_error?: string
          p_job: string
          p_ok: boolean
          p_result?: Json
        }
        Returns: undefined
      }
      record_cod_collection: {
        Args: {
          p_actor_user_id: string
          p_amount: number
          p_note: string
          p_order_id: string
          p_restaurant_id: string
        }
        Returns: Json
      }
      record_menu_page_view: {
        Args: { p_branch_id: string; p_restaurant_id: string }
        Returns: undefined
      }
      record_payment: {
        Args: {
          p_actor_user_id: string
          p_amount: number
          p_method: Database["public"]["Enums"]["payment_method"]
          p_order_id: string
          p_reference: string
          p_restaurant_id: string
        }
        Returns: Json
      }
      reorder_menu_categories: {
        Args: { p_ids: string[]; p_restaurant_id: string }
        Returns: undefined
      }
      reorder_menu_items: {
        Args: { p_category_id: string; p_ids: string[] }
        Returns: undefined
      }
      report_bot: {
        Args: {
          p_branch_id: string
          p_from: string
          p_restaurant_id: string
          p_to: string
        }
        Returns: Json
      }
      report_branches: {
        Args: { p_from: string; p_restaurant_id: string; p_to: string }
        Returns: {
          branch_id: string
          cancelled: number
          name: string
          orders: number
          received: number
          sales: number
        }[]
      }
      report_daily: {
        Args: {
          p_branch_id: string
          p_from: string
          p_restaurant_id: string
          p_to: string
        }
        Returns: {
          day: string
          orders: number
          sales: number
        }[]
      }
      report_hours: {
        Args: {
          p_branch_id: string
          p_from: string
          p_restaurant_id: string
          p_to: string
        }
        Returns: {
          hour: number
          orders: number
        }[]
      }
      report_items: {
        Args: {
          p_branch_id: string
          p_from: string
          p_limit?: number
          p_restaurant_id: string
          p_to: string
        }
        Returns: Json
      }
      report_orders_export: {
        Args: {
          p_branch_id: string
          p_from: string
          p_restaurant_id: string
          p_to: string
        }
        Returns: {
          branch_name: string
          channel: string
          created_at: string
          customer_name: string
          delivery_fee: number
          discount: number
          items: string
          order_number: number
          order_type: string
          payment_method: string
          payment_status: string
          phone_masked: string
          status: string
          subtotal: number
          total: number
        }[]
      }
      report_overview: {
        Args: {
          p_branch_id: string
          p_from: string
          p_restaurant_id: string
          p_to: string
        }
        Returns: Json
      }
      report_riders: {
        Args: {
          p_branch_id: string
          p_from: string
          p_restaurant_id: string
          p_to: string
        }
        Returns: {
          avg_minutes: number
          cash_collected: number
          deliveries: number
          failed: number
          name: string
          rider_id: string
        }[]
      }
      report_top_customers: {
        Args: {
          p_branch_id: string
          p_from: string
          p_restaurant_id: string
          p_to: string
        }
        Returns: {
          customer_id: string
          name: string
          orders: number
          phone_masked: string
          spent: number
        }[]
      }
      restaurant_usage: {
        Args: { p_month_start: string; p_restaurant_id: string }
        Returns: Json
      }
      rider_login_failed: {
        Args: { p_lock_minutes?: number; p_max?: number; p_phone: string }
        Returns: Json
      }
      run_maintenance_jobs: { Args: never; Returns: Json }
      save_menu_item: {
        Args: { p_item: Json; p_restaurant_id: string }
        Returns: string
      }
      save_modifier_group: {
        Args: { p_group: Json; p_restaurant_id: string }
        Returns: string
      }
      set_item_stock: {
        Args: {
          p_branch_id: string
          p_is_available: boolean
          p_item_id: string
        }
        Returns: boolean
      }
      set_order_hold: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_hold: boolean
          p_order_id: string
          p_reason: string
          p_restaurant_id: string
        }
        Returns: Json
      }
      settle_rider_cash: {
        Args: {
          p_amount: number
          p_notes?: string
          p_order_ids: string[]
          p_restaurant_id: string
          p_rider_id: string
          p_settled_by: string
        }
        Returns: Json
      }
      transition_order_status: {
        Args: {
          p_actor_type: Database["public"]["Enums"]["actor_type"]
          p_actor_user_id?: string
          p_expected_version: number
          p_note?: string
          p_order_id: string
          p_path: Database["public"]["Enums"]["order_status"][]
          p_reason?: string
          p_restaurant_id: string
        }
        Returns: Json
      }
      whatsapp_claim_auto_reply: {
        Args: { p_conversation_id: string; p_cooldown?: string }
        Returns: boolean
      }
      whatsapp_record_inbound: {
        Args: {
          p_body: string
          p_media_id: string
          p_phone: string
          p_profile_name: string
          p_raw: Json
          p_restaurant_id: string
          p_sent_at: string
          p_type: Database["public"]["Enums"]["wa_message_type"]
          p_wa_id: string
          p_wa_message_id: string
        }
        Returns: {
          bot_enabled: boolean
          conversation_id: string
          customer_id: string
          duplicate: boolean
          message_id: string
        }[]
      }
    }
    Enums: {
      actor_type: "staff" | "customer" | "bot" | "system"
      member_role: "owner" | "manager" | "staff" | "kitchen" | "rider"
      order_event_type:
        | "created"
        | "status_changed"
        | "edited"
        | "held"
        | "unheld"
        | "cancelled"
        | "payment_updated"
        | "note_added"
        | "printed"
        | "rider_assigned"
        | "rider_unassigned"
        | "cash_collected"
      order_source: "whatsapp" | "phone" | "walk_in" | "web"
      order_status:
        | "pending_confirmation"
        | "awaiting_acceptance"
        | "accepted"
        | "preparing"
        | "ready"
        | "out_for_delivery"
        | "delivered"
        | "completed"
        | "cancelled"
        | "failed"
      order_type: "delivery" | "pickup" | "dine_in"
      payment_method:
        | "cod"
        | "card_on_delivery"
        | "bank_transfer"
        | "online_link"
      payment_status:
        | "unpaid"
        | "pending_verification"
        | "paid"
        | "refunded"
        | "partially_refunded"
      restaurant_status: "trial" | "active" | "suspended"
      wa_conversation_status: "open" | "resolved"
      wa_direction: "inbound" | "outbound"
      wa_message_status:
        | "received"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "skipped"
      wa_message_type:
        | "text"
        | "image"
        | "audio"
        | "document"
        | "location"
        | "interactive"
        | "button"
        | "unknown"
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
      actor_type: ["staff", "customer", "bot", "system"],
      member_role: ["owner", "manager", "staff", "kitchen", "rider"],
      order_event_type: [
        "created",
        "status_changed",
        "edited",
        "held",
        "unheld",
        "cancelled",
        "payment_updated",
        "note_added",
        "printed",
        "rider_assigned",
        "rider_unassigned",
        "cash_collected",
      ],
      order_source: ["whatsapp", "phone", "walk_in", "web"],
      order_status: [
        "pending_confirmation",
        "awaiting_acceptance",
        "accepted",
        "preparing",
        "ready",
        "out_for_delivery",
        "delivered",
        "completed",
        "cancelled",
        "failed",
      ],
      order_type: ["delivery", "pickup", "dine_in"],
      payment_method: [
        "cod",
        "card_on_delivery",
        "bank_transfer",
        "online_link",
      ],
      payment_status: [
        "unpaid",
        "pending_verification",
        "paid",
        "refunded",
        "partially_refunded",
      ],
      restaurant_status: ["trial", "active", "suspended"],
      wa_conversation_status: ["open", "resolved"],
      wa_direction: ["inbound", "outbound"],
      wa_message_status: [
        "received",
        "sent",
        "delivered",
        "read",
        "failed",
        "skipped",
      ],
      wa_message_type: [
        "text",
        "image",
        "audio",
        "document",
        "location",
        "interactive",
        "button",
        "unknown",
      ],
    },
  },
} as const
