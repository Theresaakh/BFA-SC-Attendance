CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent');--> statement-breakpoint
CREATE TYPE "public"."link_method" AS ENUM('player_id', 'email', 'phone', 'name_exact', 'name_fuzzy', 'manual');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('confirmed', 'suggested', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('coach', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."sync_source" AS ENUM('odoo', 'bfa', 'matching');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('manual', 'scheduled', 'cron', 'cli');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'viewer');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"status" "attendance_status" NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"date" date NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_attendance_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"role" "staff_role" NOT NULL,
	"coach_id" integer,
	"status" "attendance_status" NOT NULL,
	"replacement_name" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaches" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_key" text NOT NULL,
	"name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"odoo_id" integer NOT NULL,
	"number" text NOT NULL,
	"customer_id" integer,
	"move_type" text NOT NULL,
	"state" text NOT NULL,
	"payment_state" text NOT NULL,
	"invoice_date" date,
	"due_date" date,
	"currency" text,
	"amount_untaxed" numeric(14, 2) DEFAULT 0 NOT NULL,
	"amount_total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"amount_residual" numeric(14, 2) DEFAULT 0 NOT NULL,
	"amount_total_signed" numeric(14, 2) DEFAULT 0 NOT NULL,
	"amount_residual_signed" numeric(14, 2) DEFAULT 0 NOT NULL,
	"reference" text,
	"origin" text,
	"odoo_write_date" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odoo_customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"odoo_id" integer NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"email" text,
	"phone" text,
	"mobile" text,
	"reference" text,
	"parent_odoo_id" integer,
	"parent_name" text,
	"is_company" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"odoo_write_date" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_invoices" (
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	CONSTRAINT "payment_invoices_payment_id_invoice_id_pk" PRIMARY KEY("payment_id","invoice_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"odoo_id" integer NOT NULL,
	"name" text,
	"customer_id" integer,
	"date" date,
	"amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"currency" text,
	"state" text,
	"payment_type" text,
	"memo" text,
	"odoo_write_date" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"team_id" integer,
	"branch_id" integer,
	"email" text,
	"phone" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"status" "link_status" NOT NULL,
	"method" "link_method" NOT NULL,
	"confidence" real NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"entity_type" text,
	"external_id" text,
	"message" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "sync_source" NOT NULL,
	"trigger" "sync_trigger" NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"processed" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"deleted" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"message" text,
	"triggered_by" integer
);
--> statement-breakpoint
CREATE TABLE "team_coaches" (
	"team_id" integer NOT NULL,
	"role" "staff_role" NOT NULL,
	"coach_id" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_coaches_team_id_role_pk" PRIMARY KEY("team_id","role")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"branch_id" integer,
	"name" text NOT NULL,
	"category" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_attendance_records" ADD CONSTRAINT "coach_attendance_records_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_attendance_records" ADD CONSTRAINT "coach_attendance_records_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_odoo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."odoo_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_odoo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."odoo_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_customer_id_odoo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."odoo_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_errors" ADD CONSTRAINT "sync_errors_run_id_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_coaches" ADD CONSTRAINT "team_coaches_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_coaches" ADD CONSTRAINT "team_coaches_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "att_records_session_player_uq" ON "attendance_records" USING btree ("session_id","player_id");--> statement-breakpoint
CREATE INDEX "att_records_player_idx" ON "attendance_records" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "att_sessions_team_date_uq" ON "attendance_sessions" USING btree ("team_id","date");--> statement-breakpoint
CREATE INDEX "att_sessions_date_idx" ON "attendance_sessions" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_external_uq" ON "branches" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_att_session_role_uq" ON "coach_attendance_records" USING btree ("session_id","role");--> statement-breakpoint
CREATE INDEX "coach_att_coach_idx" ON "coach_attendance_records" USING btree ("coach_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coaches_external_uq" ON "coaches" USING btree ("external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_odoo_uq" ON "invoices" USING btree ("odoo_id");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("state","payment_state");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "invoices_date_idx" ON "invoices" USING btree ("invoice_date");--> statement-breakpoint
CREATE UNIQUE INDEX "odoo_customers_odoo_uq" ON "odoo_customers" USING btree ("odoo_id");--> statement-breakpoint
CREATE INDEX "odoo_customers_norm_name_idx" ON "odoo_customers" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "payment_invoices_invoice_idx" ON "payment_invoices" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_odoo_uq" ON "payments" USING btree ("odoo_id");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_date_idx" ON "payments" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "players_external_uq" ON "players" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "players_team_idx" ON "players" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "players_branch_idx" ON "players" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "players_norm_name_idx" ON "players" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_pair_uq" ON "record_links" USING btree ("player_id","customer_id");--> statement-breakpoint
CREATE INDEX "record_links_customer_idx" ON "record_links" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "record_links_status_idx" ON "record_links" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_errors_run_idx" ON "sync_errors" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "sync_runs_source_started_idx" ON "sync_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "team_coaches_coach_idx" ON "team_coaches" USING btree ("coach_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_external_uq" ON "teams" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "teams_branch_idx" ON "teams" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));