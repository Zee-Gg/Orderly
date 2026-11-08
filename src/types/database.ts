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
          default_prep_minutes: number
          id: string
          is_active: boolean
          is_open: boolean
          late_order_minutes: number
          latitude: number | null
          longitude: number | null
          name: string
          opening_hours: Json | null
          phone: string | null
          restaurant_id: string
          staff_orders_need_acceptance: boolean
          updated_at: string
        }
        Insert: {
          accept_alert_minutes?: number
          address?: string | null
          area?: string | null
          auto_accept_orders?: boolean
          city?: string | null
          created_at?: string
          default_prep_minutes?: number
          id?: string
          is_active?: boolean
          is_open?: boolean
          late_order_minutes?: number
          latitude?: number | null
          longitude?: number | null
          name: string
          opening_hours?: Json | null
          phone?: string | null
          restaurant_id: string
          staff_orders_need_acceptance?: boolean
          updated_at?: string
        }
        Update: {
          accept_alert_minutes?: number
          address?: string | null
          area?: string | null
          auto_accept_orders?: boolean
          city?: string | null
          created_at?: string
          default_prep_minutes?: number
          id?: string
          is_active?: boolean
          is_open?: boolean
          late_order_minutes?: number
          latitude?: number | null
          longitude?: number | null
          name?: string
          opening_hours?: Json | null
          phone?: string | null
          restaurant_id?: string
          staff_orders_need_acceptance?: boolean
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
          branch_id: string
          cancel_note: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          delivered_at: string | null
          delivery_fee: number
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
          scheduled_for: string | null
          service_charge: number
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
          branch_id: string
          cancel_note?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_fee?: number
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
          scheduled_for?: string | null
          service_charge?: number
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
          branch_id?: string
          cancel_note?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_fee?: number
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
          scheduled_for?: string | null
          service_charge?: number
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
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
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
      restaurants: {
        Row: {
          city: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          logo_url: string | null
          name: string
          phone: string | null
          slug: string
          status: Database["public"]["Enums"]["restaurant_status"]
          timezone: string
          trial_ends_at: string | null
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          logo_url?: string | null
          name: string
          phone?: string | null
          slug: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          timezone?: string
          trial_ends_at?: string | null
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          timezone?: string
          trial_ends_at?: string | null
          updated_at?: string
          whatsapp_number?: string | null
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
      apply_price_changes: {
        Args: { p_audit: Json; p_changes: Json; p_restaurant_id: string }
        Returns: number
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
      edit_order: { Args: { p: Json }; Returns: Json }
      get_public_menu: {
        Args: { p_branch_id: string; p_restaurant_slug: string }
        Returns: Json
      }
      is_slug_available: { Args: { p_slug: string }; Returns: boolean }
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
    },
  },
} as const
