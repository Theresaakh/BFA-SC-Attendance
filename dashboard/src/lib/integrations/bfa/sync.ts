import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../../db";
import { upsertChanged, type Tx } from "../../db/upsert";
import { bfaConfig } from "../../env";
import { categoryFromTeamName, normalizeEmail, normalizeName, normalizePhone } from "../../matching/normalize";
import type { SyncReporter } from "../../sync/reporter";
import { IntegrationError } from "../errors";
import { BfaClient, type BfaChild } from "./client";

// ---------------------------------------------------------------------------
// Parsing the attendance app's data (shapes defined by teams.html)
//   branches:        [{id, name}]                          (array or id-keyed object)
//   teams:           {id: {id, branchId, name, coach, assistant}}
//   players:         {id: {id, branchId, teamId, name, ...}}
//   attendance:      {"YYYY-MM-DD": {playerId: "present" | "absent"}}
//   staffAttendance: {"YYYY-MM-DD": {teamId: {coach: {status, replacement}, assistant: {...}}}}
// ---------------------------------------------------------------------------

export type BfaSnapshot = {
  branches: { id: string; name: string }[];
  teams: { id: string; branchId: string | null; name: string; coach: string | null; assistant: string | null }[];
  players: { id: string; branchId: string | null; teamId: string | null; name: string; email: string | null; phone: string | null }[];
  attendance: { date: string; playerId: string; status: "present" | "absent" }[];
  staffAttendance: { date: string; teamId: string; role: "coach" | "assistant"; status: "present" | "absent"; replacement: string | null }[];
};

type Problem = { entity: string; reason: string; id: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function items(x: unknown): Record<string, unknown>[] {
  const arr = Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : [];
  return arr.filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
}

function str(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

function status(v: unknown): "present" | "absent" | null {
  return v === "present" || v === "absent" ? v : null;
}

export function parseSnapshot(raw: Partial<Record<BfaChild, unknown>>): { snapshot: BfaSnapshot; problems: Problem[] } {
  const problems: Problem[] = [];
  const snapshot: BfaSnapshot = { branches: [], teams: [], players: [], attendance: [], staffAttendance: [] };

  for (const b of items(raw.branches)) {
    const id = str(b.id);
    if (!id) { problems.push({ entity: "branch", reason: "Branch without an id", id: "?" }); continue; }
    snapshot.branches.push({ id, name: str(b.name) ?? "Unnamed branch" });
  }
  for (const t of items(raw.teams)) {
    const id = str(t.id);
    if (!id) { problems.push({ entity: "team", reason: "Team without an id", id: "?" }); continue; }
    snapshot.teams.push({ id, branchId: str(t.branchId), name: str(t.name) ?? "Unnamed team", coach: str(t.coach), assistant: str(t.assistant) });
  }
  for (const p of items(raw.players)) {
    const id = str(p.id);
    const name = str(p.name);
    if (!id) { problems.push({ entity: "player", reason: "Player without an id", id: "?" }); continue; }
    if (!name) { problems.push({ entity: "player", reason: "Player without a name", id }); continue; }
    snapshot.players.push({
      id,
      name,
      branchId: str(p.branchId),
      teamId: str(p.teamId),
      // Not captured by the attendance app today; read if they are ever added.
      email: str(p.email) ?? str(p.parentEmail),
      phone: str(p.phone) ?? str(p.parentPhone) ?? str(p.mobile),
    });
  }

  const att = raw.attendance && typeof raw.attendance === "object" ? (raw.attendance as Record<string, unknown>) : {};
  for (const [date, byPlayer] of Object.entries(att)) {
    if (!DATE_RE.test(date)) { problems.push({ entity: "attendance", reason: "Invalid session date", id: date }); continue; }
    if (!byPlayer || typeof byPlayer !== "object") continue;
    for (const [playerId, st] of Object.entries(byPlayer as Record<string, unknown>)) {
      const s = status(st);
      if (!s) { problems.push({ entity: "attendance", reason: `Unknown attendance status "${String(st)}"`, id: `${date}/${playerId}` }); continue; }
      snapshot.attendance.push({ date, playerId, status: s });
    }
  }

  const staff = raw.staffAttendance && typeof raw.staffAttendance === "object" ? (raw.staffAttendance as Record<string, unknown>) : {};
  for (const [date, byTeam] of Object.entries(staff)) {
    if (!DATE_RE.test(date)) { problems.push({ entity: "staffAttendance", reason: "Invalid session date", id: date }); continue; }
    if (!byTeam || typeof byTeam !== "object") continue;
    for (const [teamId, roles] of Object.entries(byTeam as Record<string, unknown>)) {
      if (!roles || typeof roles !== "object") continue;
      for (const role of ["coach", "assistant"] as const) {
        const entry = (roles as Record<string, unknown>)[role] as Record<string, unknown> | undefined;
        if (!entry) continue;
        const s = status(entry.status);
        if (!s) { problems.push({ entity: "staffAttendance", reason: `Unknown staff status "${String(entry.status)}"`, id: `${date}/${teamId}/${role}` }); continue; }
        snapshot.staffAttendance.push({ date, teamId, role, status: s, replacement: s === "absent" ? str(entry.replacement) : null });
      }
    }
  }
  return { snapshot, problems };
}

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

export async function syncBfa(report: SyncReporter, opts: { client?: BfaClient; raw?: Partial<Record<BfaChild, unknown>> } = {}) {
  let raw = opts.raw;
  if (!raw) {
    const cfg = bfaConfig();
    if (!cfg.configured && !opts.client) {
      throw new IntegrationError("BFA attendance", "not_configured",
        `The BFA attendance integration is not configured. Set ${cfg.missing.join(", ")} in the server environment.`);
    }
    const client = opts.client ?? new BfaClient(cfg);
    raw = await client.fetchAll();
  }
  if (!raw.players && !raw.teams && !raw.attendance) {
    throw new IntegrationError("BFA attendance", "invalid_response",
      "The attendance database returned no teams, players or attendance. Check BFA_FIREBASE_ROOT_PATH (expected the app's data root, e.g. bfaTeamsState).");
  }

  const { snapshot, problems } = parseSnapshot(raw);
  recordProblems(report, problems.splice(0));
  report.note("Attendance is attributed to each player's current team; the attendance app does not keep team history.");

  await db().transaction(async (tx) => {
    const now = new Date();

    // ---- Branches ----
    const branchRes = await upsertChanged(tx, schema.branches, snapshot.branches.map((b) => ({ externalId: b.id, name: b.name, deletedAt: null })), {
      target: schema.branches.externalId,
      compare: ["name", "deletedAt"],
    });
    report.merge({ processed: snapshot.branches.length, added: branchRes.added, updated: branchRes.updated, skipped: branchRes.unchanged });
    report.deleted += await softDeleteMissingByExternal(tx, "branches", new Set(snapshot.branches.map((b) => b.id)), now);
    const branchIdByExt = await idMap(tx, "branches");

    // ---- Teams ----
    const teamRows = snapshot.teams.map((t) => {
      if (t.branchId && !branchIdByExt.has(t.branchId)) problems.push({ entity: "team", reason: "Team refers to an unknown branch", id: t.id });
      return { externalId: t.id, name: t.name, branchId: (t.branchId && branchIdByExt.get(t.branchId)) || null, category: categoryFromTeamName(t.name), deletedAt: null };
    });
    const teamRes = await upsertChanged(tx, schema.teams, teamRows, { target: schema.teams.externalId, compare: ["name", "branchId", "category", "deletedAt"] });
    report.merge({ processed: teamRows.length, added: teamRes.added, updated: teamRes.updated, skipped: teamRes.unchanged });
    report.deleted += await softDeleteMissingByExternal(tx, "teams", new Set(snapshot.teams.map((t) => t.id)), now);
    const teamIdByExt = await idMap(tx, "teams");

    // ---- Coaches & team assignments ----
    const coachNames = new Map<string, string>();
    for (const t of snapshot.teams) for (const n of [t.coach, t.assistant]) if (n && normalizeName(n)) coachNames.set(normalizeName(n), n);
    const coachRes = await upsertChanged(tx, schema.coaches, [...coachNames].map(([key, name]) => ({ externalKey: key, name, deletedAt: null })), {
      target: schema.coaches.externalKey,
      compare: ["name", "deletedAt"],
    });
    report.merge({ processed: coachNames.size, added: coachRes.added, updated: coachRes.updated, skipped: coachRes.unchanged });
    const coachRows = await tx.select({ id: schema.coaches.id, key: schema.coaches.externalKey }).from(schema.coaches);
    const coachIdByKey = new Map(coachRows.map((c) => [c.key, c.id]));

    const desiredAssignments = new Map<string, number>(); // `${teamId}|${role}` -> coachId
    for (const t of snapshot.teams) {
      const teamId = teamIdByExt.get(t.id);
      if (!teamId) continue;
      if (t.coach && coachIdByKey.has(normalizeName(t.coach))) desiredAssignments.set(`${teamId}|coach`, coachIdByKey.get(normalizeName(t.coach))!);
      if (t.assistant && coachIdByKey.has(normalizeName(t.assistant))) desiredAssignments.set(`${teamId}|assistant`, coachIdByKey.get(normalizeName(t.assistant))!);
    }
    const currentAssignments = await tx.select().from(schema.teamCoaches);
    for (const a of currentAssignments) {
      const want = desiredAssignments.get(`${a.teamId}|${a.role}`);
      if (want === a.coachId) desiredAssignments.delete(`${a.teamId}|${a.role}`);
      else if (want === undefined) {
        await tx.delete(schema.teamCoaches).where(teamRoleWhere(a.teamId, a.role));
      }
    }
    for (const [key, coachId] of desiredAssignments) {
      const [teamId, role] = key.split("|") as [string, "coach" | "assistant"];
      await tx.insert(schema.teamCoaches).values({ teamId: Number(teamId), role, coachId })
        .onConflictDoUpdate({ target: [schema.teamCoaches.teamId, schema.teamCoaches.role], set: { coachId } });
    }

    // ---- Players ----
    const teamBranchByExt = new Map(snapshot.teams.map((t) => [t.id, t.branchId]));
    const playerRows = snapshot.players.map((p) => {
      if (p.teamId && !teamIdByExt.has(p.teamId)) problems.push({ entity: "player", reason: "Player refers to an unknown team", id: p.id });
      const branchExt = p.branchId ?? (p.teamId ? teamBranchByExt.get(p.teamId) ?? null : null);
      return {
        externalId: p.id,
        name: p.name,
        normalizedName: normalizeName(p.name),
        teamId: (p.teamId && teamIdByExt.get(p.teamId)) || null,
        branchId: (branchExt && branchIdByExt.get(branchExt)) || null,
        email: normalizeEmail(p.email),
        phone: p.phone && normalizePhone(p.phone) ? p.phone : null,
        deletedAt: null,
      };
    });
    const playerRes = await upsertChanged(tx, schema.players, playerRows, {
      target: schema.players.externalId,
      compare: ["name", "normalizedName", "teamId", "branchId", "email", "phone", "deletedAt"],
    });
    report.merge({ processed: playerRows.length, added: playerRes.added, updated: playerRes.updated, skipped: playerRes.unchanged });
    report.deleted += await softDeleteMissingByExternal(tx, "players", new Set(snapshot.players.map((p) => p.id)), now);

    const playerInfo = new Map(
      (await tx.select({ id: schema.players.id, ext: schema.players.externalId, teamId: schema.players.teamId }).from(schema.players)).map((p) => [p.ext, p]),
    );

    // ---- Sessions ----
    const sessionKeys = new Set<string>();
    const recordDesired = new Map<string, "present" | "absent">(); // `${teamId}|${date}|${playerId}`
    for (const a of snapshot.attendance) {
      const p = playerInfo.get(a.playerId);
      if (!p) { problems.push({ entity: "attendance", reason: "Attendance for a player who no longer exists", id: `${a.date}/${a.playerId}` }); continue; }
      if (!p.teamId) { problems.push({ entity: "attendance", reason: "Attendance for a player without a team", id: `${a.date}/${a.playerId}` }); continue; }
      sessionKeys.add(`${p.teamId}|${a.date}`);
      recordDesired.set(`${p.teamId}|${a.date}|${p.id}`, a.status);
    }
    const coachTeamRole = new Map((await tx.select().from(schema.teamCoaches)).map((a) => [`${a.teamId}|${a.role}`, a.coachId]));
    const staffDesired = new Map<string, { status: "present" | "absent"; replacement: string | null; coachId: number | null }>();
    for (const s of snapshot.staffAttendance) {
      const teamId = teamIdByExt.get(s.teamId);
      if (!teamId) { problems.push({ entity: "staffAttendance", reason: "Staff attendance for an unknown team", id: `${s.date}/${s.teamId}` }); continue; }
      sessionKeys.add(`${teamId}|${s.date}`);
      staffDesired.set(`${teamId}|${s.date}|${s.role}`, { status: s.status, replacement: s.replacement, coachId: coachTeamRole.get(`${teamId}|${s.role}`) ?? null });
    }

    const existingSessions = await tx.select({ id: schema.attendanceSessions.id, teamId: schema.attendanceSessions.teamId, date: schema.attendanceSessions.date, deletedAt: schema.attendanceSessions.deletedAt }).from(schema.attendanceSessions);
    const sessionByKey = new Map(existingSessions.map((s) => [`${s.teamId}|${s.date}`, s]));
    const newSessions = [...sessionKeys].filter((k) => !sessionByKey.has(k)).map((k) => {
      const [teamId, date] = k.split("|");
      return { teamId: Number(teamId), date };
    });
    for (let i = 0; i < newSessions.length; i += 1000) {
      const inserted = await tx.insert(schema.attendanceSessions).values(newSessions.slice(i, i + 1000)).onConflictDoNothing()
        .returning({ id: schema.attendanceSessions.id, teamId: schema.attendanceSessions.teamId, date: schema.attendanceSessions.date, deletedAt: schema.attendanceSessions.deletedAt });
      inserted.forEach((s) => sessionByKey.set(`${s.teamId}|${s.date}`, s));
    }
    report.added += newSessions.length;
    report.processed += sessionKeys.size;
    const revive = existingSessions.filter((s) => s.deletedAt && sessionKeys.has(`${s.teamId}|${s.date}`)).map((s) => s.id);
    const retire = existingSessions.filter((s) => !s.deletedAt && !sessionKeys.has(`${s.teamId}|${s.date}`)).map((s) => s.id);
    await setDeleted(tx, "attendance_sessions", revive, null);
    await setDeleted(tx, "attendance_sessions", retire, now);
    report.updated += revive.length;
    report.deleted += retire.length;

    // ---- Player attendance records ----
    const existingRecords = await tx.select({
      id: schema.attendanceRecords.id, sessionId: schema.attendanceRecords.sessionId, playerId: schema.attendanceRecords.playerId,
      status: schema.attendanceRecords.status, deletedAt: schema.attendanceRecords.deletedAt,
    }).from(schema.attendanceRecords);
    const recordByKey = new Map(existingRecords.map((r) => [`${r.sessionId}|${r.playerId}`, r]));
    const toInsert: { sessionId: number; playerId: number; status: "present" | "absent" }[] = [];
    const toUpdate: { id: number; status: "present" | "absent" }[] = [];
    const keep = new Set<number>();
    for (const [key, st] of recordDesired) {
      const [teamId, date, playerId] = key.split("|");
      const session = sessionByKey.get(`${teamId}|${date}`)!;
      const existing = recordByKey.get(`${session.id}|${playerId}`);
      if (!existing) toInsert.push({ sessionId: session.id, playerId: Number(playerId), status: st });
      else {
        keep.add(existing.id);
        if (existing.status !== st || existing.deletedAt) toUpdate.push({ id: existing.id, status: st });
        else report.skipped++;
      }
    }
    for (let i = 0; i < toInsert.length; i += 1000) await tx.insert(schema.attendanceRecords).values(toInsert.slice(i, i + 1000)).onConflictDoNothing();
    await bulkUpdateStatus(tx, toUpdate);
    const retireRecords = existingRecords.filter((r) => !r.deletedAt && !keep.has(r.id)).map((r) => r.id);
    await setDeleted(tx, "attendance_records", retireRecords, now);
    report.merge({ processed: recordDesired.size, added: toInsert.length, updated: toUpdate.length, deleted: retireRecords.length });

    // ---- Coach attendance records ----
    const existingStaff = await tx.select().from(schema.coachAttendanceRecords);
    const staffByKey = new Map(existingStaff.map((r) => [`${r.sessionId}|${r.role}`, r]));
    const keepStaff = new Set<number>();
    let staffAdded = 0, staffUpdated = 0;
    for (const [key, val] of staffDesired) {
      const [teamId, date, role] = key.split("|") as [string, string, "coach" | "assistant"];
      const session = sessionByKey.get(`${teamId}|${date}`)!;
      const existing = staffByKey.get(`${session.id}|${role}`);
      if (!existing) {
        await tx.insert(schema.coachAttendanceRecords).values({ sessionId: session.id, role, coachId: val.coachId, status: val.status, replacementName: val.replacement });
        staffAdded++;
        continue;
      }
      keepStaff.add(existing.id);
      // The coach on record for past sessions is kept; only fill it in if it was unknown.
      const coachId = existing.coachId ?? val.coachId;
      if (existing.status !== val.status || existing.replacementName !== val.replacement || existing.deletedAt || existing.coachId !== coachId) {
        await tx.update(schema.coachAttendanceRecords)
          .set({ status: val.status, replacementName: val.replacement, coachId, deletedAt: null })
          .where(inArray(schema.coachAttendanceRecords.id, [existing.id]));
        staffUpdated++;
      } else report.skipped++;
    }
    const retireStaff = existingStaff.filter((r) => !r.deletedAt && !keepStaff.has(r.id)).map((r) => r.id);
    await setDeleted(tx, "coach_attendance_records", retireStaff, now);
    report.merge({ processed: staffDesired.size, added: staffAdded, updated: staffUpdated, deleted: retireStaff.length });
  });

  // Problems discovered while resolving references inside the transaction.
  recordProblems(report, problems.splice(0));
}

function recordProblems(report: SyncReporter, problems: Problem[]) {
  // Group identical problems so one bad import does not flood the error log.
  const groups = new Map<string, Problem[]>();
  for (const p of problems) {
    const key = `${p.entity}|${p.reason}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (const [, list] of groups) {
    report.skipped += list.length;
    report.error(list[0].entity, list.length === 1 ? list[0].id : null,
      new Error(list.length === 1 ? list[0].reason : `${list[0].reason} (${list.length} records)`),
      { sampleIds: list.slice(0, 20).map((p) => p.id) });
  }
}

type SoftTable = "branches" | "teams" | "players";

async function idMap(tx: Tx, table: SoftTable): Promise<Map<string, number>> {
  const t = schema[table];
  const rows = await tx.select({ id: t.id, ext: t.externalId }).from(t).where(isNull(t.deletedAt));
  return new Map(rows.map((r) => [r.ext, r.id]));
}

async function softDeleteMissingByExternal(tx: Tx, table: SoftTable, live: Set<string>, now: Date): Promise<number> {
  const t = schema[table];
  const rows = await tx.select({ id: t.id, ext: t.externalId }).from(t).where(isNull(t.deletedAt));
  const missing = rows.filter((r) => !live.has(r.ext)).map((r) => r.id);
  for (let i = 0; i < missing.length; i += 1000) {
    await tx.update(t).set({ deletedAt: now }).where(inArray(t.id, missing.slice(i, i + 1000)));
  }
  return missing.length;
}

const DELETABLE = {
  attendance_sessions: schema.attendanceSessions,
  attendance_records: schema.attendanceRecords,
  coach_attendance_records: schema.coachAttendanceRecords,
} as const;

async function setDeleted(tx: Tx, table: keyof typeof DELETABLE, ids: number[], value: Date | null) {
  const t = DELETABLE[table];
  for (let i = 0; i < ids.length; i += 1000) {
    await tx.update(t).set({ deletedAt: value }).where(inArray(t.id, ids.slice(i, i + 1000)));
  }
}

async function bulkUpdateStatus(tx: Tx, rows: { id: number; status: "present" | "absent" }[]) {
  for (const st of ["present", "absent"] as const) {
    const ids = rows.filter((r) => r.status === st).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 1000) {
      await tx.update(schema.attendanceRecords).set({ status: st, deletedAt: null }).where(inArray(schema.attendanceRecords.id, ids.slice(i, i + 1000)));
    }
  }
}

function teamRoleWhere(teamId: number, role: "coach" | "assistant") {
  return and(eq(schema.teamCoaches.teamId, teamId), eq(schema.teamCoaches.role, role));
}
