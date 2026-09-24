import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guard";
import { db, schema } from "@/lib/db";
import { bfaConfig, odooConfig } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { getKv, getSettings } from "@/lib/settings";
import { SERVER_INFO_KEY } from "@/lib/integrations/odoo/sync";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { KeyValue, PageHeader } from "@/components/ui/misc";
import { AddUserForm, ConnectionTest, FullResync, PasswordForm, SettingsForm, UserActiveToggle } from "./forms";

export const metadata = { title: "Settings" };

function Status({ configured, missing }: { configured: boolean; missing: string[] }) {
  return configured ? <Badge tone="green">Configured</Badge> : <Badge tone="amber">Missing {missing.join(", ")}</Badge>;
}

function mask(v: string) {
  if (!v) return "—";
  const [user, domain] = v.split("@");
  return domain ? `${user.slice(0, 2)}•••@${domain}` : `${v.slice(0, 2)}•••`;
}

export default async function SettingsPage() {
  const user = await requireUser();
  const canEdit = user.role === "admin";
  const [settings, odooInfo] = await Promise.all([
    getSettings(),
    getKv<{ serverVersion: string; protocol: string; checkedAt: string }>(SERVER_INFO_KEY),
  ]);
  const odoo = odooConfig();
  const bfa = bfaConfig();
  const users = canEdit ? await db().select().from(schema.users).orderBy(asc(schema.users.name)) : [];

  return (
    <>
      <PageHeader title="Settings" subtitle="Synchronisation, integrations and user accounts" />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Synchronisation & rules" subtitle="Stored in the database; changes apply immediately" />
          <CardBody><SettingsForm settings={settings} canEdit={canEdit} /></CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Odoo" subtitle="Customer invoices, payments and customers" action={<Status configured={odoo.configured} missing={odoo.missing} />} />
            <CardBody className="space-y-5">
              <KeyValue items={[
                { label: "Server", value: odoo.url || "—" },
                { label: "Database", value: odoo.db || "—" },
                { label: "User", value: mask(odoo.login) },
                { label: "API key", value: odoo.apiKey ? "Set (hidden)" : "Not set" },
                { label: "Protocol", value: odooInfo ? `${odooInfo.protocol === "json2" ? "JSON-2" : "JSON-RPC"} · Odoo ${odooInfo.serverVersion}` : odoo.protocol },
                { label: "Player ID field", value: <code className="text-xs">{odoo.playerIdField}</code> },
              ]} />
              {canEdit ? <ConnectionTest system="odoo" /> : null}
              {odooInfo?.checkedAt ? <p className="text-xs text-muted">Last connected {formatDateTime(odooInfo.checkedAt)}</p> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="BFA attendance app" subtitle="Branches, teams, players, coaches and attendance" action={<Status configured={bfa.configured} missing={bfa.missing} />} />
            <CardBody className="space-y-5">
              <KeyValue items={[
                { label: "Database", value: bfa.databaseUrl || "—" },
                { label: "Data root", value: <code className="text-xs">{bfa.rootPath}</code> },
                { label: "Authentication", value: bfa.authMode === "service_account" ? "Service account" : bfa.authMode === "database_secret" ? "Database secret" : "None (public rules)" },
                { label: "Credential", value: bfa.serviceAccountJson || bfa.databaseSecret ? "Set (hidden)" : "Not set" },
              ]} />
              {canEdit ? <ConnectionTest system="bfa" /> : null}
            </CardBody>
          </Card>
        </div>

        {canEdit ? (
          <Card>
            <CardHeader title="Full resynchronisation" subtitle="Re-reads every record instead of only recent changes. Use after fixing configuration or data problems." />
            <CardBody><FullResync /></CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Your password" subtitle="Changing it signs you out on every other device" />
          <CardBody><PasswordForm /></CardBody>
        </Card>

        {canEdit ? (
          <Card>
            <CardHeader title="Users" subtitle="Administrators can sync, link records and change settings; viewers have read-only access" />
            <Table>
              <thead><tr><Th>Name</Th><Th>E-mail</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th className="text-right">Action</Th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <Tr key={u.id}>
                    <Td className="font-semibold">{u.name}{u.id === user.id ? <span className="ml-2 text-xs font-normal text-muted">(you)</span> : null}</Td>
                    <Td className="text-ink-2">{u.email}</Td>
                    <Td><Badge tone={u.role === "admin" ? "navy" : "gray"} dot={false}>{u.role === "admin" ? "Administrator" : "Viewer"}</Badge></Td>
                    <Td><Badge tone={u.isActive ? "green" : "gray"}>{u.isActive ? "Active" : "Deactivated"}</Badge></Td>
                    <Td className="text-ink-2">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</Td>
                    <Td className="text-right">{u.id !== user.id ? <UserActiveToggle userId={u.id} active={u.isActive} /> : null}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <CardBody className="border-t border-line"><AddUserForm /></CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
