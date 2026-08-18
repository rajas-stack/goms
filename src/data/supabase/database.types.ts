export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
          changed_at: string
          changed_by: string | null
          entity_id: string
          entity_type: string
          field: string
          id: string
          new_value: string
          old_value: string
          reason: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          entity_id: string
          entity_type: string
          field?: string
          id?: string
          new_value?: string
          old_value?: string
          reason?: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          entity_id?: string
          entity_type?: string
          field?: string
          id?: string
          new_value?: string
          old_value?: string
          reason?: string
        }
        Relationships: []
      }
      charges: {
        Row: {
          department_id: string | null
          employee_id: string
          end_date: string | null
          id: string
          kind: string
          reason: string
          start_date: string | null
          title: string
        }
        Insert: {
          department_id?: string | null
          employee_id: string
          end_date?: string | null
          id?: string
          kind: string
          reason?: string
          start_date?: string | null
          title?: string
        }
        Update: {
          department_id?: string | null
          employee_id?: string
          end_date?: string | null
          id?: string
          kind?: string
          reason?: string
          start_date?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "charges_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_approval_matrix: {
        Row: {
          active: boolean
          allow_auto_approval: boolean
          approval_level_label: string
          code: string
          description: string
          display_order: number
          id: string
          max_discount_pct: number
          min_discount_pct: number
          name: string
        }
        Insert: {
          active?: boolean
          allow_auto_approval?: boolean
          approval_level_label?: string
          code: string
          description?: string
          display_order?: number
          id?: string
          max_discount_pct: number
          min_discount_pct: number
          name: string
        }
        Update: {
          active?: boolean
          allow_auto_approval?: boolean
          approval_level_label?: string
          code?: string
          description?: string
          display_order?: number
          id?: string
          max_discount_pct?: number
          min_discount_pct?: number
          name?: string
        }
        Relationships: []
      }
      commercial_billing_types: {
        Row: {
          active: boolean
          code: string
          description: string
          display_order: number
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          display_order?: number
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      commercial_bom_items: {
        Row: {
          component_sku_id: string
          id: string
          mandatory: boolean
          notes: string
          parent_sku_id: string
          quantity: number
        }
        Insert: {
          component_sku_id: string
          id?: string
          mandatory?: boolean
          notes?: string
          parent_sku_id: string
          quantity?: number
        }
        Update: {
          component_sku_id?: string
          id?: string
          mandatory?: boolean
          notes?: string
          parent_sku_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "commercial_bom_items_component_sku_id_fkey"
            columns: ["component_sku_id"]
            isOneToOne: false
            referencedRelation: "commercial_skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_bom_items_parent_sku_id_fkey"
            columns: ["parent_sku_id"]
            isOneToOne: false
            referencedRelation: "commercial_skus"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_boq_line_items: {
        Row: {
          approval_date: string | null
          approval_remarks: string
          approval_status: string
          approver_id: string | null
          boq_id: string
          discount_pct: number
          id: string
          line_total: number
          quantity: number
          sku_id: string
          tax_pct: number
          unit_price: number
        }
        Insert: {
          approval_date?: string | null
          approval_remarks?: string
          approval_status?: string
          approver_id?: string | null
          boq_id: string
          discount_pct?: number
          id?: string
          line_total?: number
          quantity?: number
          sku_id: string
          tax_pct?: number
          unit_price?: number
        }
        Update: {
          approval_date?: string | null
          approval_remarks?: string
          approval_status?: string
          approver_id?: string | null
          boq_id?: string
          discount_pct?: number
          id?: string
          line_total?: number
          quantity?: number
          sku_id?: string
          tax_pct?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "commercial_boq_line_items_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_boq_line_items_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "commercial_boqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_boq_line_items_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "commercial_skus"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_boq_number_seq: {
        Row: {
          next_seq: number
          year: number
        }
        Insert: {
          next_seq?: number
          year: number
        }
        Update: {
          next_seq?: number
          year?: number
        }
        Relationships: []
      }
      commercial_boqs: {
        Row: {
          boq_number: string
          boq_version: number
          bu_sales_person_id: string | null
          budget_amount: string
          budget_known: string
          budget_unit: string
          created_at: string
          created_by: string | null
          currency: string
          customer_address: string
          customer_contact: string
          customer_gst: string
          customer_id: string | null
          customer_name: string
          customer_organization: string
          department_id: string
          emd_amount: string
          emd_unit: string
          grand_total: number
          id: string
          last_modified_at: string
          last_modified_by: string | null
          opportunity_name: string
          parent_boq_id: string | null
          pre_sales_id: string | null
          revision_number: number
          sales_person_id: string
          status: string
          vertical_id: string
        }
        Insert: {
          boq_number: string
          boq_version?: number
          bu_sales_person_id?: string | null
          budget_amount?: string
          budget_known?: string
          budget_unit?: string
          created_at?: string
          created_by?: string | null
          currency: string
          customer_address?: string
          customer_contact?: string
          customer_gst?: string
          customer_id?: string | null
          customer_name?: string
          customer_organization?: string
          department_id: string
          emd_amount?: string
          emd_unit?: string
          grand_total?: number
          id?: string
          last_modified_at?: string
          last_modified_by?: string | null
          opportunity_name?: string
          parent_boq_id?: string | null
          pre_sales_id?: string | null
          revision_number?: number
          sales_person_id: string
          status?: string
          vertical_id: string
        }
        Update: {
          boq_number?: string
          boq_version?: number
          bu_sales_person_id?: string | null
          budget_amount?: string
          budget_known?: string
          budget_unit?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address?: string
          customer_contact?: string
          customer_gst?: string
          customer_id?: string | null
          customer_name?: string
          customer_organization?: string
          department_id?: string
          emd_amount?: string
          emd_unit?: string
          grand_total?: number
          id?: string
          last_modified_at?: string
          last_modified_by?: string | null
          opportunity_name?: string
          parent_boq_id?: string | null
          pre_sales_id?: string | null
          revision_number?: number
          sales_person_id?: string
          status?: string
          vertical_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_boqs_bu_sales_person_id_fkey"
            columns: ["bu_sales_person_id"]
            isOneToOne: false
            referencedRelation: "sales_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_boqs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_boqs_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_boqs_parent_boq_id_fkey"
            columns: ["parent_boq_id"]
            isOneToOne: false
            referencedRelation: "commercial_boqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_boqs_pre_sales_id_fkey"
            columns: ["pre_sales_id"]
            isOneToOne: false
            referencedRelation: "commercial_pre_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_boqs_sales_person_id_fkey"
            columns: ["sales_person_id"]
            isOneToOne: false
            referencedRelation: "sales_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_boqs_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "commercial_verticals"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_currencies: {
        Row: {
          active: boolean
          code: string
          decimal_places: number
          description: string
          display_order: number
          exchange_rate: number
          id: string
          is_base_currency: boolean
          name: string
          symbol: string
        }
        Insert: {
          active?: boolean
          code: string
          decimal_places?: number
          description?: string
          display_order?: number
          exchange_rate: number
          id?: string
          is_base_currency?: boolean
          name: string
          symbol: string
        }
        Update: {
          active?: boolean
          code?: string
          decimal_places?: number
          description?: string
          display_order?: number
          exchange_rate?: number
          id?: string
          is_base_currency?: boolean
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      commercial_features: {
        Row: {
          active: boolean
          code: string
          description: string
          display_order: number
          id: string
          module_id: string
          name: string
          status: string
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          display_order?: number
          id?: string
          module_id: string
          name: string
          status: string
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          display_order?: number
          id?: string
          module_id?: string
          name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_features_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "commercial_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_modules: {
        Row: {
          active: boolean
          code: string
          description: string
          display_order: number
          id: string
          name: string
          product_id: string
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          display_order?: number
          id?: string
          name: string
          product_id: string
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          display_order?: number
          id?: string
          name?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_modules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "commercial_products"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_pre_sales: {
        Row: {
          active: boolean
          code: string
          description: string
          display_order: number
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          display_order?: number
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      commercial_product_edition_features: {
        Row: {
          display_order: number
          edition_id: string
          feature_id: string
          id: string
          mandatory: boolean
        }
        Insert: {
          display_order?: number
          edition_id: string
          feature_id: string
          id?: string
          mandatory?: boolean
        }
        Update: {
          display_order?: number
          edition_id?: string
          feature_id?: string
          id?: string
          mandatory?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "commercial_product_edition_features_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "commercial_product_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_product_edition_features_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "commercial_features"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_product_editions: {
        Row: {
          active: boolean
          code: string
          description: string
          display_order: number
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          display_order?: number
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      commercial_products: {
        Row: {
          active: boolean
          code: string
          description: string
          display_order: number
          id: string
          name: string
          vertical_id: string
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          display_order?: number
          id?: string
          name: string
          vertical_id: string
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          display_order?: number
          id?: string
          name?: string
          vertical_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_products_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "commercial_verticals"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_sku_categories: {
        Row: {
          active: boolean
          code: string
          description: string
          display_order: number
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          display_order?: number
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      commercial_skus: {
        Row: {
          active_from: string
          active_till: string | null
          base_software_cost: number
          billing_type_id: string
          category_id: string
          cloud_cost: number
          corporate_price: number
          created_at: string
          created_by: string | null
          currency_id: string
          display_order: number
          edition_id: string
          enterprise_price: number
          feature_id: string
          floor_price: number
          government_price: number
          hardware_cost: number
          id: string
          implementation_cost_per_mm: number
          integration_cost: number
          internal_price: number
          is_sellable: boolean
          lifecycle_status: string
          list_price: number
          maximum_discount_percent: number
          minimum_allowed_price: number
          name: string
          partner_price: number
          sku_code: string
          support_cost: number
          tax_class_id: string
          third_party_cost: number
          training_cost: number
          uom_id: string
        }
        Insert: {
          active_from: string
          active_till?: string | null
          base_software_cost?: number
          billing_type_id: string
          category_id: string
          cloud_cost?: number
          corporate_price?: number
          created_at?: string
          created_by?: string | null
          currency_id: string
          display_order?: number
          edition_id: string
          enterprise_price?: number
          feature_id: string
          floor_price?: number
          government_price?: number
          hardware_cost?: number
          id?: string
          implementation_cost_per_mm?: number
          integration_cost?: number
          internal_price?: number
          is_sellable?: boolean
          lifecycle_status?: string
          list_price?: number
          maximum_discount_percent?: number
          minimum_allowed_price?: number
          name: string
          partner_price?: number
          sku_code: string
          support_cost?: number
          tax_class_id: string
          third_party_cost?: number
          training_cost?: number
          uom_id: string
        }
        Update: {
          active_from?: string
          active_till?: string | null
          base_software_cost?: number
          billing_type_id?: string
          category_id?: string
          cloud_cost?: number
          corporate_price?: number
          created_at?: string
          created_by?: string | null
          currency_id?: string
          display_order?: number
          edition_id?: string
          enterprise_price?: number
          feature_id?: string
          floor_price?: number
          government_price?: number
          hardware_cost?: number
          id?: string
          implementation_cost_per_mm?: number
          integration_cost?: number
          internal_price?: number
          is_sellable?: boolean
          lifecycle_status?: string
          list_price?: number
          maximum_discount_percent?: number
          minimum_allowed_price?: number
          name?: string
          partner_price?: number
          sku_code?: string
          support_cost?: number
          tax_class_id?: string
          third_party_cost?: number
          training_cost?: number
          uom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_skus_billing_type_id_fkey"
            columns: ["billing_type_id"]
            isOneToOne: false
            referencedRelation: "commercial_billing_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_skus_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "commercial_sku_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_skus_currency_id_fkey"
            columns: ["currency_id"]
            isOneToOne: false
            referencedRelation: "commercial_currencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_skus_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "commercial_product_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_skus_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "commercial_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_skus_tax_class_id_fkey"
            columns: ["tax_class_id"]
            isOneToOne: false
            referencedRelation: "commercial_tax_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_skus_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "commercial_units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_tax_classes: {
        Row: {
          active: boolean
          code: string
          description: string
          display_order: number
          id: string
          name: string
          rate_pct: number
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          display_order?: number
          id?: string
          name: string
          rate_pct?: number
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          display_order?: number
          id?: string
          name?: string
          rate_pct?: number
        }
        Relationships: []
      }
      commercial_units_of_measure: {
        Row: {
          active: boolean
          code: string
          description: string
          display_order: number
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          display_order?: number
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      commercial_verticals: {
        Row: {
          active: boolean
          code: string
          description: string
          display_order: number
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          display_order?: number
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string
          contact_email: string
          contact_name: string
          contact_phone: string
          created_at: string
          gst: string
          id: string
          name: string
          notes: string
          organization: string
          updated_at: string
        }
        Insert: {
          address?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          gst?: string
          id?: string
          name: string
          notes?: string
          organization?: string
          updated_at?: string
        }
        Update: {
          address?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          gst?: string
          id?: string
          name?: string
          notes?: string
          organization?: string
          updated_at?: string
        }
        Relationships: []
      }
      departments: {
        Row: {
          code: string | null
          created_at: string
          id: string
          metadata: Json
          name: string
          parent_id: string | null
          sort_order: number
          state_code: number | null
          status: string
          type_key: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id: string
          metadata?: Json
          name: string
          parent_id?: string | null
          sort_order?: number
          state_code?: number | null
          status?: string
          type_key: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          parent_id?: string | null
          sort_order?: number
          state_code?: number | null
          status?: string
          type_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_type_key_fkey"
            columns: ["type_key"]
            isOneToOne: false
            referencedRelation: "node_types"
            referencedColumns: ["key"]
          },
        ]
      }
      employees: {
        Row: {
          address: string
          auth_user_id: string | null
          code: string
          company: string
          connected: boolean
          created_at: string
          department_id: string | null
          designation: string
          email: string
          follow_up_date: string | null
          id: string
          important_contact: boolean
          introduced_by: string
          last_interaction_at: string | null
          manager_id: string | null
          metadata: Json
          name: string
          notes: string
          phone: string
          photo_url: string | null
          preferred_comm: string[]
          relationship_quality: string
          relationship_status: string
          relationship_type: string
          status: string
          updated_at: string
          vacant: boolean
          website: string
        }
        Insert: {
          address?: string
          auth_user_id?: string | null
          code?: string
          company?: string
          connected?: boolean
          created_at?: string
          department_id?: string | null
          designation?: string
          email?: string
          follow_up_date?: string | null
          id?: string
          important_contact?: boolean
          introduced_by?: string
          last_interaction_at?: string | null
          manager_id?: string | null
          metadata?: Json
          name?: string
          notes?: string
          phone?: string
          photo_url?: string | null
          preferred_comm?: string[]
          relationship_quality?: string
          relationship_status?: string
          relationship_type?: string
          status?: string
          updated_at?: string
          vacant?: boolean
          website?: string
        }
        Update: {
          address?: string
          auth_user_id?: string | null
          code?: string
          company?: string
          connected?: boolean
          created_at?: string
          department_id?: string | null
          designation?: string
          email?: string
          follow_up_date?: string | null
          id?: string
          important_contact?: boolean
          introduced_by?: string
          last_interaction_at?: string | null
          manager_id?: string | null
          metadata?: Json
          name?: string
          notes?: string
          phone?: string
          photo_url?: string | null
          preferred_comm?: string[]
          relationship_quality?: string
          relationship_status?: string
          relationship_type?: string
          status?: string
          updated_at?: string
          vacant?: boolean
          website?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          assignee_id: string | null
          created_at: string
          created_by: string | null
          due_date: string
          entity_id: string
          entity_type: string
          id: string
          note: string
          status: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date: string
          entity_id: string
          entity_type: string
          id?: string
          note?: string
          status?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string
          entity_id?: string
          entity_type?: string
          id?: string
          note?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "sales_people"
            referencedColumns: ["id"]
          },
        ]
      }
      geo_nodes: {
        Row: {
          code: string | null
          created_at: string
          id: string
          lgd_code: string | null
          name: string
          parent_id: string | null
          sort_order: number
          state_code: number | null
          status: string
          type_key: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id: string
          lgd_code?: string | null
          name: string
          parent_id?: string | null
          sort_order?: number
          state_code?: number | null
          status?: string
          type_key: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          lgd_code?: string | null
          name?: string
          parent_id?: string | null
          sort_order?: number
          state_code?: number | null
          status?: string
          type_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "geo_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "geo_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geo_nodes_type_key_fkey"
            columns: ["type_key"]
            isOneToOne: false
            referencedRelation: "node_types"
            referencedColumns: ["key"]
          },
        ]
      }
      merge_audit_records: {
        Row: {
          duplicate_id: string
          duplicate_name: string
          field_resolutions: Json
          id: string
          merged_at: string
          survivor_id: string
          survivor_name: string
          transferred: Json
        }
        Insert: {
          duplicate_id: string
          duplicate_name: string
          field_resolutions?: Json
          id?: string
          merged_at?: string
          survivor_id: string
          survivor_name: string
          transferred?: Json
        }
        Update: {
          duplicate_id?: string
          duplicate_name?: string
          field_resolutions?: Json
          id?: string
          merged_at?: string
          survivor_id?: string
          survivor_name?: string
          transferred?: Json
        }
        Relationships: [
          {
            foreignKeyName: "merge_audit_records_survivor_id_fkey"
            columns: ["survivor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      node_types: {
        Row: {
          child_keys: string[]
          domain: string
          icon: string
          key: string
          label: string
          level: number
        }
        Insert: {
          child_keys?: string[]
          domain: string
          icon: string
          key: string
          label: string
          level: number
        }
        Update: {
          child_keys?: string[]
          domain?: string
          icon?: string
          key?: string
          label?: string
          level?: number
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          budget_known: string
          closed_on: string | null
          component: string[]
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string | null
          department_id: string
          emd_amount: string
          emd_unit: string
          gem_tender_id: string
          id: string
          opportunity_name: string
          publish_date: string | null
          quantity: string
          sales_person_id: string | null
          stage_key: string
          submission_date: string | null
          value_amount: string
          value_unit: string
          vertical: string
        }
        Insert: {
          budget_known?: string
          closed_on?: string | null
          component?: string[]
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          department_id: string
          emd_amount?: string
          emd_unit?: string
          gem_tender_id?: string
          id?: string
          opportunity_name?: string
          publish_date?: string | null
          quantity?: string
          sales_person_id?: string | null
          stage_key: string
          submission_date?: string | null
          value_amount?: string
          value_unit?: string
          vertical?: string
        }
        Update: {
          budget_known?: string
          closed_on?: string | null
          component?: string[]
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          department_id?: string
          emd_amount?: string
          emd_unit?: string
          gem_tender_id?: string
          id?: string
          opportunity_name?: string
          publish_date?: string | null
          quantity?: string
          sales_person_id?: string | null
          stage_key?: string
          submission_date?: string | null
          value_amount?: string
          value_unit?: string
          vertical?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_sales_person_id_fkey"
            columns: ["sales_person_id"]
            isOneToOne: false
            referencedRelation: "sales_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_stage_key_fkey"
            columns: ["stage_key"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["key"]
          },
        ]
      }
      opportunity_stage_changes: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_stage_key: string | null
          id: string
          note: string
          opportunity_id: string
          to_stage_key: string
        }
        Insert: {
          changed_at: string
          changed_by?: string | null
          from_stage_key?: string | null
          id?: string
          note?: string
          opportunity_id: string
          to_stage_key: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_stage_key?: string | null
          id?: string
          note?: string
          opportunity_id?: string
          to_stage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_stage_changes_from_stage_key_fkey"
            columns: ["from_stage_key"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "opportunity_stage_changes_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_stage_changes_to_stage_key_fkey"
            columns: ["to_stage_key"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["key"]
          },
        ]
      }
      ownership_assignments: {
        Row: {
          batch_id: string | null
          created_at: string
          created_by: string | null
          end_date: string | null
          entity_id: string
          entity_type: string
          id: string
          note: string
          reason: string
          role: string
          sales_person_id: string
          start_date: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          entity_id: string
          entity_type: string
          id?: string
          note?: string
          reason: string
          role: string
          sales_person_id: string
          start_date: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          note?: string
          reason?: string
          role?: string
          sales_person_id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ownership_assignments_sales_person_id_fkey"
            columns: ["sales_person_id"]
            isOneToOne: false
            referencedRelation: "sales_people"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          is_closed: boolean
          is_won: boolean
          key: string
          label: string
          order: number
          probability: number
        }
        Insert: {
          is_closed?: boolean
          is_won?: boolean
          key: string
          label: string
          order: number
          probability: number
        }
        Update: {
          is_closed?: boolean
          is_won?: boolean
          key?: string
          label?: string
          order?: number
          probability?: number
        }
        Relationships: []
      }
      sales_people: {
        Row: {
          alt_mobile: string
          auth_user_id: string | null
          created_at: string
          created_by: string | null
          employee_code: string
          id: string
          joined_on: string | null
          left_on: string | null
          metadata: Json
          mobile: string
          name: string
          notes: string
          official_email: string
          personal_email: string
          status: string
        }
        Insert: {
          alt_mobile?: string
          auth_user_id?: string | null
          created_at?: string
          created_by?: string | null
          employee_code?: string
          id?: string
          joined_on?: string | null
          left_on?: string | null
          metadata?: Json
          mobile?: string
          name: string
          notes?: string
          official_email: string
          personal_email?: string
          status?: string
        }
        Update: {
          alt_mobile?: string
          auth_user_id?: string | null
          created_at?: string
          created_by?: string | null
          employee_code?: string
          id?: string
          joined_on?: string | null
          left_on?: string | null
          metadata?: Json
          mobile?: string
          name?: string
          notes?: string
          official_email?: string
          personal_email?: string
          status?: string
        }
        Relationships: []
      }
      sales_postings: {
        Row: {
          change_type: string
          created_at: string
          created_by: string | null
          designation: string
          end_date: string | null
          id: string
          manager_id: string | null
          office: string
          reason: string
          sales_person_id: string
          start_date: string | null
          tier_key: string
        }
        Insert: {
          change_type: string
          created_at?: string
          created_by?: string | null
          designation?: string
          end_date?: string | null
          id?: string
          manager_id?: string | null
          office?: string
          reason?: string
          sales_person_id: string
          start_date?: string | null
          tier_key: string
        }
        Update: {
          change_type?: string
          created_at?: string
          created_by?: string | null
          designation?: string
          end_date?: string | null
          id?: string
          manager_id?: string | null
          office?: string
          reason?: string
          sales_person_id?: string
          start_date?: string | null
          tier_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_postings_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "sales_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_postings_sales_person_id_fkey"
            columns: ["sales_person_id"]
            isOneToOne: false
            referencedRelation: "sales_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_postings_tier_key_fkey"
            columns: ["tier_key"]
            isOneToOne: false
            referencedRelation: "sales_tiers"
            referencedColumns: ["key"]
          },
        ]
      }
      sales_tiers: {
        Row: {
          active: boolean
          key: string
          label: string
          rank: number
        }
        Insert: {
          active?: boolean
          key: string
          label: string
          rank: number
        }
        Update: {
          active?: boolean
          key?: string
          label?: string
          rank?: number
        }
        Relationships: []
      }
      timeline_events: {
        Row: {
          attended: boolean | null
          attendees: string[]
          custom_label: string | null
          employee_id: string
          event_date: string
          event_time: string | null
          id: string
          note: string
          source: string
          title: string
          type: string
        }
        Insert: {
          attended?: boolean | null
          attendees?: string[]
          custom_label?: string | null
          employee_id: string
          event_date: string
          event_time?: string | null
          id?: string
          note?: string
          source: string
          title?: string
          type: string
        }
        Update: {
          attended?: boolean | null
          attendees?: string[]
          custom_label?: string | null
          employee_id?: string
          event_date?: string
          event_time?: string | null
          id?: string
          note?: string
          source?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          effective_date: string
          employee_id: string
          from_department_name: string
          from_designation: string
          from_manager_name: string
          from_office_name: string
          id: string
          reason: string
          remarks: string
          to_department_name: string
          to_designation: string
          to_manager_name: string
          to_office_name: string
          to_org_node_id: string | null
        }
        Insert: {
          effective_date: string
          employee_id: string
          from_department_name?: string
          from_designation?: string
          from_manager_name?: string
          from_office_name?: string
          id?: string
          reason?: string
          remarks?: string
          to_department_name?: string
          to_designation?: string
          to_manager_name?: string
          to_office_name?: string
          to_org_node_id?: string | null
        }
        Update: {
          effective_date?: string
          employee_id?: string
          from_department_name?: string
          from_designation?: string
          from_manager_name?: string
          from_office_name?: string
          id?: string
          reason?: string
          remarks?: string
          to_department_name?: string
          to_designation?: string
          to_manager_name?: string
          to_office_name?: string
          to_org_node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transfers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_org_node_id_fkey"
            columns: ["to_org_node_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      visiting_cards: {
        Row: {
          back_name: string | null
          back_path: string | null
          employee_id: string
          front_name: string
          front_path: string
          id: string
        }
        Insert: {
          back_name?: string | null
          back_path?: string | null
          employee_id: string
          front_name?: string
          front_path: string
          id?: string
        }
        Update: {
          back_name?: string | null
          back_path?: string | null
          employee_id?: string
          front_name?: string
          front_path?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visiting_cards_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allocate_boq_number: { Args: { p_year: number }; Returns: string }
      department_subtree_ids: { Args: { p_id: string }; Returns: string[] }
      geo_node_subtree_ids: { Args: { p_id: string }; Returns: string[] }
      merge_employees: {
        Args: {
          p_duplicate_id: string
          p_resolutions: Json
          p_survivor_id: string
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

