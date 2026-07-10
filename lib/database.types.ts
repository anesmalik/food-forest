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
      ai_call_log: {
        Row: {
          citations_valid: boolean | null
          created_at: string
          function: Database["public"]["Enums"]["ai_function"]
          id: string
          latency_ms: number | null
          model_name: string
          prompt: string
          query: string
          response: string
          retrieved_ids: Json
          tokens_in: number | null
          tokens_out: number | null
          user_id: string | null
        }
        Insert: {
          citations_valid?: boolean | null
          created_at?: string
          function: Database["public"]["Enums"]["ai_function"]
          id?: string
          latency_ms?: number | null
          model_name: string
          prompt: string
          query: string
          response: string
          retrieved_ids?: Json
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
        }
        Update: {
          citations_valid?: boolean | null
          created_at?: string
          function?: Database["public"]["Enums"]["ai_function"]
          id?: string
          latency_ms?: number | null
          model_name?: string
          prompt?: string
          query?: string
          response?: string
          retrieved_ids?: Json
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      embeddings: {
        Row: {
          chunk_index: number
          chunk_text: string
          content_id: string
          content_type: Database["public"]["Enums"]["content_type"]
          created_at: string
          embedding: string | null
          id: string
          model_name: string
        }
        Insert: {
          chunk_index?: number
          chunk_text: string
          content_id: string
          content_type: Database["public"]["Enums"]["content_type"]
          created_at?: string
          embedding?: string | null
          id?: string
          model_name: string
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          content_id?: string
          content_type?: Database["public"]["Enums"]["content_type"]
          created_at?: string
          embedding?: string | null
          id?: string
          model_name?: string
        }
        Relationships: []
      }
      entities: {
        Row: {
          created_at: string
          created_by: string
          deactivated_at: string | null
          id: string
          metadata: Json
          name: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deactivated_at?: string | null
          id?: string
          metadata?: Json
          name: string
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deactivated_at?: string | null
          id?: string
          metadata?: Json
          name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "entities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entities_type_fkey"
            columns: ["type"]
            isOneToOne: false
            referencedRelation: "entity_types"
            referencedColumns: ["key"]
          },
        ]
      }
      entity_types: {
        Row: {
          key: string
          label: string
        }
        Insert: {
          key: string
          label: string
        }
        Update: {
          key?: string
          label?: string
        }
        Relationships: []
      }
      journal_entries: {
        Row: {
          author_id: string
          body: string
          body_normalized: string
          corrects_entry_id: string | null
          created_at: string
          id: string
          sensitivity: Database["public"]["Enums"]["sensitivity"]
          soft_deleted_at: string | null
          task_id: string | null
        }
        Insert: {
          author_id: string
          body: string
          corrects_entry_id?: string | null
          created_at?: string
          id?: string
          sensitivity?: Database["public"]["Enums"]["sensitivity"]
          soft_deleted_at?: string | null
          task_id?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          corrects_entry_id?: string | null
          created_at?: string
          id?: string
          sensitivity?: Database["public"]["Enums"]["sensitivity"]
          soft_deleted_at?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_entities: {
        Row: {
          entity_id: string
          journal_entry_id: string
        }
        Insert: {
          entity_id: string
          journal_entry_id: string
        }
        Update: {
          entity_id?: string
          journal_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_entities_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_entities_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_answer_versions: {
        Row: {
          answer_id: string
          body: string
          created_at: string
          id: string
        }
        Insert: {
          answer_id: string
          body: string
          created_at?: string
          id?: string
        }
        Update: {
          answer_id?: string
          body?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_answer_versions_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "qa_answers"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_answers: {
        Row: {
          answerer_id: string
          created_at: string
          current_version_id: string | null
          id: string
          thread_id: string
        }
        Insert: {
          answerer_id: string
          created_at?: string
          current_version_id?: string | null
          id?: string
          thread_id: string
        }
        Update: {
          answerer_id?: string
          created_at?: string
          current_version_id?: string | null
          id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_answers_answerer_id_fkey"
            columns: ["answerer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_answers_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "qa_answer_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_answers_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "qa_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_threads: {
        Row: {
          asker_id: string
          created_at: string
          id: string
          question: string
          status: Database["public"]["Enums"]["qa_status"]
          visibility_scope: Database["public"]["Enums"]["visibility_scope"]
        }
        Insert: {
          asker_id: string
          created_at?: string
          id?: string
          question: string
          status?: Database["public"]["Enums"]["qa_status"]
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Update: {
          asker_id?: string
          created_at?: string
          id?: string
          question?: string
          status?: Database["public"]["Enums"]["qa_status"]
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "qa_threads_asker_id_fkey"
            columns: ["asker_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_file_entities: {
        Row: {
          entity_id: string
          raw_file_id: string
        }
        Insert: {
          entity_id: string
          raw_file_id: string
        }
        Update: {
          entity_id?: string
          raw_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_file_entities_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_file_entities_raw_file_id_fkey"
            columns: ["raw_file_id"]
            isOneToOne: false
            referencedRelation: "raw_files"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_files: {
        Row: {
          content_hash: string
          created_at: string
          filename: string
          id: string
          mime_type: string
          storage_path: string
          uploader_id: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          filename: string
          id?: string
          mime_type: string
          storage_path: string
          uploader_id: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          filename?: string
          id?: string
          mime_type?: string
          storage_path?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_files_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string
          assigner_id: string
          completed_at: string | null
          created_at: string
          description: string
          due_date: string | null
          id: string
          state: Database["public"]["Enums"]["task_state"]
          title: string
        }
        Insert: {
          assignee_id: string
          assigner_id: string
          completed_at?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          state?: Database["public"]["Enums"]["task_state"]
          title: string
        }
        Update: {
          assignee_id?: string
          assigner_id?: string
          completed_at?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          state?: Database["public"]["Enums"]["task_state"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigner_id_fkey"
            columns: ["assigner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          event_type: string
          id: number
          metadata: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: number
          metadata?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: number
          metadata?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          clerk_id: string
          created_at: string
          deactivated_at: string | null
          display_name: string
          email: string
          id: string
          role: Database["public"]["Enums"]["user_role"] | null
          supervisor_id: string | null
        }
        Insert: {
          clerk_id: string
          created_at?: string
          deactivated_at?: string | null
          display_name: string
          email: string
          id?: string
          role: Database["public"]["Enums"]["user_role"] | null
          supervisor_id?: string | null
        }
        Update: {
          clerk_id?: string
          created_at?: string
          deactivated_at?: string | null
          display_name?: string
          email?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"] | null
          supervisor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wiki_entries: {
        Row: {
          created_at: string
          current_version_id: string | null
          id: string
          owner_id: string
          soft_deleted_at: string | null
        }
        Insert: {
          created_at?: string
          current_version_id?: string | null
          id?: string
          owner_id: string
          soft_deleted_at?: string | null
        }
        Update: {
          created_at?: string
          current_version_id?: string | null
          id?: string
          owner_id?: string
          soft_deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wiki_entries_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "wiki_entry_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_entries_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wiki_entry_versions: {
        Row: {
          body: string
          created_at: string
          created_by: string
          entity_id: string | null
          id: string
          sensitivity: Database["public"]["Enums"]["sensitivity"]
          title: string
          wiki_entry_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          entity_id?: string | null
          id?: string
          sensitivity?: Database["public"]["Enums"]["sensitivity"]
          title: string
          wiki_entry_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          entity_id?: string | null
          id?: string
          sensitivity?: Database["public"]["Enums"]["sensitivity"]
          title?: string
          wiki_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wiki_entry_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_entry_versions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_entry_versions_wiki_entry_id_fkey"
            columns: ["wiki_entry_id"]
            isOneToOne: false
            referencedRelation: "wiki_entries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_user_placement: {
        Args: { target: string; new_role: Database["public"]["Enums"]["user_role"]; new_supervisor: string | null }
        Returns: undefined
      }
      try_bootstrap_admin: {
        Args: { target_user_id: string; bootstrap_email: string }
        Returns: string
      }
      current_app_user: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_in_subtree: {
        Args: { ancestor: string; descendant: string }
        Returns: boolean
      }
      normalize_for_search: {
        Args: { input: string }
        Returns: string
      }
      journal_page: {
        Args: {
          p_limit?: number
          p_cursor_created_at?: string | null
          p_cursor_id?: string | null
          p_author_filter?: string | null
        }
        Returns: {
          id: string
          author_id: string
          author_name: string | null
          body: string | null
          sensitivity: Database["public"]["Enums"]["sensitivity"]
          created_at: string
          soft_deleted_at: string | null
          corrects_entry_id: string | null
          corrects_entry_created_at: string | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string | null
        }[]
      }
      journal_search: {
        Args: { p_query: string; p_limit?: number }
        Returns: {
          id: string
          author_id: string
          author_name: string | null
          body: string | null
          sensitivity: Database["public"]["Enums"]["sensitivity"]
          created_at: string
          soft_deleted_at: string | null
          corrects_entry_id: string | null
          corrects_entry_created_at: string | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string | null
        }[]
      }
    }
    Enums: {
      ai_function:
        | "supervisor_summary"
        | "cross_team_query"
        | "synthesis_prep"
        | "clone_agent"
      content_type:
        | "journal_entry"
        | "wiki_entry_version"
        | "qa_answer_version"
        | "qa_question"
      qa_status: "open" | "answered" | "escalated" | "closed"
      sensitivity: "normal" | "restricted"
      task_state:
        | "assigned"
        | "in_progress"
        | "completed"
        | "missed"
        | "cancelled"
      user_role: "admin" | "consultant" | "site_manager" | "foreman"
      visibility_scope: "tier" | "subtree" | "organization"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

export type Task = Database["public"]["Tables"]["tasks"]["Row"]

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
    Enums: {
      ai_function: [
        "supervisor_summary",
        "cross_team_query",
        "synthesis_prep",
        "clone_agent",
      ],
      content_type: [
        "journal_entry",
        "wiki_entry_version",
        "qa_answer_version",
        "qa_question",
      ],
      qa_status: ["open", "answered", "escalated", "closed"],
      sensitivity: ["normal", "restricted"],
      task_state: [
        "assigned",
        "in_progress",
        "completed",
        "missed",
        "cancelled",
      ],
      user_role: ["admin", "consultant", "site_manager", "foreman"],
      visibility_scope: ["tier", "subtree", "organization"],
    },
  },
} as const
