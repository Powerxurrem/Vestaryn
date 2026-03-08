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
      credit_ledger: {
        Row: {
          delta: number
          id: number
          meta: Json
          reason: string
          ts: string
          user_id: string
        }
        Insert: {
          delta: number
          id?: number
          meta?: Json
          reason: string
          ts?: string
          user_id: string
        }
        Update: {
          delta?: number
          id?: number
          meta?: Json
          reason?: string
          ts?: string
          user_id?: string
        }
        Relationships: []
      }
      repo_changes: {
        Row: {
          actor_user_id: string
          base_state: Json | null
          created_at: string
          id: string
          proposal: Json
          repo_id: string
          status: string
          updated_at: string
        }
        Insert: {
          actor_user_id: string
          base_state?: Json | null
          created_at?: string
          id?: string
          proposal: Json
          repo_id: string
          status: string
          updated_at?: string
        }
        Update: {
          actor_user_id?: string
          base_state?: Json | null
          created_at?: string
          id?: string
          proposal?: Json
          repo_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repo_changes_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
        ]
      }
      repo_chat_state: {
        Row: {
          cutoff_created_at: string
          repo_id: string
          updated_at: string
        }
        Insert: {
          cutoff_created_at?: string
          repo_id: string
          updated_at?: string
        }
        Update: {
          cutoff_created_at?: string
          repo_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repo_chat_state_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: true
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
        ]
      }
      repo_chat_summaries: {
        Row: {
          created_at: string
          created_by: string
          id: string
          repo_id: string
          summary_md: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          repo_id: string
          summary_md: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          repo_id?: string
          summary_md?: string
        }
        Relationships: []
      }
      repo_file_locks: {
        Row: {
          expires_at: string
          file_id: string
          locked_at: string
          locked_by: string
        }
        Insert: {
          expires_at: string
          file_id: string
          locked_at?: string
          locked_by: string
        }
        Update: {
          expires_at?: string
          file_id?: string
          locked_at?: string
          locked_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "repo_file_locks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: true
            referencedRelation: "repo_files"
            referencedColumns: ["id"]
          },
        ]
      }
      repo_file_versions: {
        Row: {
          actor: string
          created_at: string
          created_by: string | null
          file_id: string
          id: string
          mime: string | null
          note: string | null
          sha256: string
          size_bytes: number
          storage_key: string
          version: number
        }
        Insert: {
          actor: string
          created_at?: string
          created_by?: string | null
          file_id: string
          id?: string
          mime?: string | null
          note?: string | null
          sha256: string
          size_bytes?: number
          storage_key: string
          version: number
        }
        Update: {
          actor?: string
          created_at?: string
          created_by?: string | null
          file_id?: string
          id?: string
          mime?: string | null
          note?: string | null
          sha256?: string
          size_bytes?: number
          storage_key?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "repo_file_versions_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "repo_files"
            referencedColumns: ["id"]
          },
        ]
      }
      repo_files: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          mime: string
          name: string
          path: string
          repo_id: string
          sha256: string | null
          size_bytes: number
          storage_key: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          mime?: string
          name: string
          path: string
          repo_id: string
          sha256?: string | null
          size_bytes?: number
          storage_key: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          mime?: string
          name?: string
          path?: string
          repo_id?: string
          sha256?: string | null
          size_bytes?: number
          storage_key?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "repo_files_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
        ]
      }
      repo_memory_docs: {
        Row: {
          content: string
          key: string
          meta: Json
          repo_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: string
          key: string
          meta?: Json
          repo_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: string
          key?: string
          meta?: Json
          repo_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repo_memory_docs_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
        ]
      }
      repo_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          repo_id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          repo_id: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          repo_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repo_messages_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
        ]
      }
      repo_runs: {
        Row: {
          actor_user_id: string | null
          change_id: string | null
          command: string
          created_at: string
          duration_ms: number
          exit_code: number
          failed_step: string | null
          failure_kind: string | null
          id: string
          job_id: string | null
          ok: boolean
          repo_id: string
          runner_fingerprint: string | null
          status: string
          stderr: string
          stdout: string
          summary: string | null
          timed_out: boolean | null
          touched_file_ids: string[]
          updated_at: string
        }
        Insert: {
          actor_user_id?: string | null
          change_id?: string | null
          command: string
          created_at?: string
          duration_ms: number
          exit_code: number
          failed_step?: string | null
          failure_kind?: string | null
          id?: string
          job_id?: string | null
          ok: boolean
          repo_id: string
          runner_fingerprint?: string | null
          status?: string
          stderr?: string
          stdout?: string
          summary?: string | null
          timed_out?: boolean | null
          touched_file_ids?: string[]
          updated_at?: string
        }
        Update: {
          actor_user_id?: string | null
          change_id?: string | null
          command?: string
          created_at?: string
          duration_ms?: number
          exit_code?: number
          failed_step?: string | null
          failure_kind?: string | null
          id?: string
          job_id?: string | null
          ok?: boolean
          repo_id?: string
          runner_fingerprint?: string | null
          status?: string
          stderr?: string
          stdout?: string
          summary?: string | null
          timed_out?: boolean | null
          touched_file_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repo_runs_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
        ]
      }
      repos: {
        Row: {
          created_at: string
          default_branch: string | null
          id: string
          name: string
          provider: string
          provider_repo_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          default_branch?: string | null
          id?: string
          name: string
          provider?: string
          provider_repo_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          default_branch?: string | null
          id?: string
          name?: string
          provider?: string
          provider_repo_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_credits: {
        Row: {
          created_at: string
          credits_balance: number
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_balance?: number
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits_balance?: number
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workspace_credit_balances: {
        Row: {
          credits_granted: number
          credits_reserved: number
          credits_spent: number
          period_start: string
          tier: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          credits_granted: number
          credits_reserved?: number
          credits_spent?: number
          period_start: string
          tier: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          credits_granted?: number
          credits_reserved?: number
          credits_spent?: number
          period_start?: string
          tier?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_credit_balances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_credit_charges: {
        Row: {
          actor_user_id: string
          amount: number
          created_at: string
          meta: Json
          period_start: string
          repo_id: string | null
          request_id: string
          workspace_id: string
        }
        Insert: {
          actor_user_id: string
          amount: number
          created_at?: string
          meta?: Json
          period_start: string
          repo_id?: string | null
          request_id: string
          workspace_id: string
        }
        Update: {
          actor_user_id?: string
          amount?: number
          created_at?: string
          meta?: Json
          period_start?: string
          repo_id?: string | null
          request_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_credit_charges_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_credit_charges_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_credit_events: {
        Row: {
          actor_user_id: string | null
          amount: number
          created_at: string
          id: number
          kind: string
          meta: Json
          period_start: string
          repo_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_user_id?: string | null
          amount: number
          created_at?: string
          id?: number
          kind: string
          meta?: Json
          period_start: string
          repo_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_user_id?: string | null
          amount?: number
          created_at?: string
          id?: number
          kind?: string
          meta?: Json
          period_start?: string
          repo_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_credit_events_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_credit_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      credits_charge: {
        Args: {
          _amount: number
          _meta: Json
          _period_start: string
          _repo_id: string
          _request_id: string
          _workspace_id: string
        }
        Returns: {
          duplicated: boolean
          ok: boolean
          remaining: number
        }[]
      }
      credits_get_status: {
        Args: {
          _grant: number
          _period_start: string
          _tier: string
          _workspace_id: string
        }
        Returns: {
          credits_granted: number
          credits_reserved: number
          credits_spent: number
          period_start: string
          remaining: number
          tier: string
        }[]
      }
      is_repo_member: { Args: { _repo_id: string }; Returns: boolean }
      is_self: { Args: { _user_id: string }; Returns: boolean }
      is_workspace_member: { Args: { _workspace_id: string }; Returns: boolean }
      spend_credits: {
        Args: {
          p_amount: number
          p_meta?: Json
          p_reason: string
          p_user_id: string
        }
        Returns: number
      }
      utc_month_start: { Args: { ts: string }; Returns: string }
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
  public: {
    Enums: {},
  },
} as const
