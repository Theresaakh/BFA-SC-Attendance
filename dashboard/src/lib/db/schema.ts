import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Soft-delete marker: set when a record disappears from its source system. */
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

// ---------------------------------------------------------------------------
// Users & sessions
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["admin", "viewer"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("admin"),
  isActive: boolean("is_active").notNull().default(true),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

export const sessions = pgTable("sessions", {
  /** SHA-256 of the session token; the raw token only ever lives in the user's cookie. */
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)]);

// ---------------------------------------------------------------------------
// Attendance side (BFA attendance app)
// ---------------------------------------------------------------------------

export const branches = pgTable("branches", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  deletedAt: deletedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("branches_external_uq").on(t.externalId)]);

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull(),
  branchId: integer("branch_id").references(() => branches.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  /** Age category derived from the team name (e.g. "U14"), if recognisable. */
  category: text("category"),
  deletedAt: deletedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("teams_external_uq").on(t.externalId), index("teams_branch_idx").on(t.branchId)]);

export const coaches = pgTable("coaches", {
  id: serial("id").primaryKey(),
  /** The attendance app stores coaches as names on teams; the normalised name is the key. */
  externalKey: text("external_key").notNull(),
  name: text("name").notNull(),
  deletedAt: deletedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("coaches_external_uq").on(t.externalKey)]);

export const staffRole = pgEnum("staff_role", ["coach", "assistant"]);

export const teamCoaches = pgTable("team_coaches", {
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  role: staffRole("role").notNull(),
  coachId: integer("coach_id").notNull().references(() => coaches.id, { onDelete: "cascade" }),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.teamId, t.role] }), index("team_coaches_coach_idx").on(t.coachId)]);

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  branchId: integer("branch_id").references(() => branches.id, { onDelete: "set null" }),
  email: text("email"),
  phone: text("phone"),
  deletedAt: deletedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("players_external_uq").on(t.externalId),
  index("players_team_idx").on(t.teamId),
  index("players_branch_idx").on(t.branchId),
  index("players_norm_name_idx").on(t.normalizedName),
]);

export const attendanceStatus = pgEnum("attendance_status", ["present", "absent"]);

/** One training session = one team on one date (as recorded in the attendance app). */
export const attendanceSessions = pgTable("attendance_sessions", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  deletedAt: deletedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("att_sessions_team_date_uq").on(t.teamId, t.date), index("att_sessions_date_idx").on(t.date)]);

export const attendanceRecords = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => attendanceSessions.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  status: attendanceStatus("status").notNull(),
  deletedAt: deletedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("att_records_session_player_uq").on(t.sessionId, t.playerId),
  index("att_records_player_idx").on(t.playerId),
]);

export const coachAttendanceRecords = pgTable("coach_attendance_records", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => attendanceSessions.id, { onDelete: "cascade" }),
  role: staffRole("role").notNull(),
  coachId: integer("coach_id").references(() => coaches.id, { onDelete: "set null" }),
  status: attendanceStatus("status").notNull(),
  replacementName: text("replacement_name"),
  deletedAt: deletedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("coach_att_session_role_uq").on(t.sessionId, t.role),
  index("coach_att_coach_idx").on(t.coachId),
]);

// ---------------------------------------------------------------------------
// Finance side (Odoo)
// ---------------------------------------------------------------------------

export const odooCustomers = pgTable("odoo_customers", {
  id: serial("id").primaryKey(),
  odooId: integer("odoo_id").notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  mobile: text("mobile"),
  /** Value of the configured "player ID" field in Odoo (default: Internal Reference). */
  reference: text("reference"),
  parentOdooId: integer("parent_odoo_id"),
  parentName: text("parent_name"),
  isCompany: boolean("is_company").notNull().default(false),
  active: boolean("active").notNull().default(true),
  odooWriteDate: timestamp("odoo_write_date", { withTimezone: true }),
  deletedAt: deletedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("odoo_customers_odoo_uq").on(t.odooId), index("odoo_customers_norm_name_idx").on(t.normalizedName)]);

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  odooId: integer("odoo_id").notNull(),
  number: text("number").notNull(),
  customerId: integer("customer_id").references(() => odooCustomers.id, { onDelete: "set null" }),
  /** out_invoice | out_refund */
  moveType: text("move_type").notNull(),
  /** draft | posted | cancel */
  state: text("state").notNull(),
  /** not_paid | in_payment | paid | partial | reversed | invoicing_legacy */
  paymentState: text("payment_state").notNull(),
  invoiceDate: date("invoice_date", { mode: "string" }),
  dueDate: date("due_date", { mode: "string" }),
  currency: text("currency"),
  amountUntaxed: money("amount_untaxed").notNull().default(0),
  amountTotal: money("amount_total").notNull().default(0),
  amountResidual: money("amount_residual").notNull().default(0),
  /** Company-currency, signed amounts (credit notes are negative). Used for all totals. */
  amountTotalSigned: money("amount_total_signed").notNull().default(0),
  amountResidualSigned: money("amount_residual_signed").notNull().default(0),
  reference: text("reference"),
  origin: text("origin"),
  odooWriteDate: timestamp("odoo_write_date", { withTimezone: true }),
  deletedAt: deletedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("invoices_odoo_uq").on(t.odooId),
  index("invoices_customer_idx").on(t.customerId),
  index("invoices_status_idx").on(t.state, t.paymentState),
  index("invoices_due_idx").on(t.dueDate),
  index("invoices_date_idx").on(t.invoiceDate),
]);

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  odooId: integer("odoo_id").notNull(),
  name: text("name"),
  customerId: integer("customer_id").references(() => odooCustomers.id, { onDelete: "set null" }),
  date: date("date", { mode: "string" }),
  amount: money("amount").notNull().default(0),
  currency: text("currency"),
  state: text("state"),
  paymentType: text("payment_type"),
  memo: text("memo"),
  odooWriteDate: timestamp("odoo_write_date", { withTimezone: true }),
  deletedAt: deletedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("payments_odoo_uq").on(t.odooId),
  index("payments_customer_idx").on(t.customerId),
  index("payments_date_idx").on(t.date),
]);

export const paymentInvoices = pgTable("payment_invoices", {
  paymentId: integer("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.paymentId, t.invoiceId] }), index("payment_invoices_invoice_idx").on(t.invoiceId)]);

// ---------------------------------------------------------------------------
// Record matching (player <-> Odoo customer)
// ---------------------------------------------------------------------------

/** confirmed = used for reporting; suggested = awaiting admin review; rejected = never suggest again. */
export const linkStatus = pgEnum("link_status", ["confirmed", "suggested", "rejected"]);
export const linkMethod = pgEnum("link_method", ["player_id", "email", "phone", "name_exact", "name_fuzzy", "manual"]);

export const recordLinks = pgTable("record_links", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => odooCustomers.id, { onDelete: "cascade" }),
  status: linkStatus("status").notNull(),
  method: linkMethod("method").notNull(),
  confidence: real("confidence").notNull(),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("record_links_pair_uq").on(t.playerId, t.customerId),
  index("record_links_customer_idx").on(t.customerId),
  index("record_links_status_idx").on(t.status),
]);

// ---------------------------------------------------------------------------
// Synchronisation & settings
// ---------------------------------------------------------------------------

export const syncSource = pgEnum("sync_source", ["odoo", "bfa", "matching"]);
export const syncTrigger = pgEnum("sync_trigger", ["manual", "scheduled", "cron", "cli"]);
export const syncStatus = pgEnum("sync_status", ["running", "success", "partial", "failed"]);

export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  source: syncSource("source").notNull(),
  trigger: syncTrigger("trigger").notNull(),
  status: syncStatus("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  processed: integer("processed").notNull().default(0),
  added: integer("added").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  deleted: integer("deleted").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  message: text("message"),
  triggeredBy: integer("triggered_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [index("sync_runs_source_started_idx").on(t.source, t.startedAt)]);

export const syncErrors = pgTable("sync_errors", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => syncRuns.id, { onDelete: "cascade" }),
  entityType: text("entity_type"),
  externalId: text("external_id"),
  message: text("message").notNull(),
  details: jsonb("details"),
  createdAt: createdAt(),
}, (t) => [index("sync_errors_run_idx").on(t.runId)]);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});
