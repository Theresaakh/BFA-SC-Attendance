const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

// Set these with: firebase functions:secrets:set ODOO_URL / ODOO_DB / ODOO_KEY / ODOO_UID / STAFF_PIN
const ODOO_URL = defineSecret("ODOO_URL");
const ODOO_DB = defineSecret("ODOO_DB");
const ODOO_KEY = defineSecret("ODOO_KEY");
const ODOO_UID = defineSecret("ODOO_UID");
const STAFF_PIN = defineSecret("STAFF_PIN");

const ALLOWED_ORIGINS = new Set([
  "https://theresaakh.github.io",
  "http://localhost:8791",
  "http://127.0.0.1:8791",
]);

let rpcId = 0;

async function odooCall(base, db, uid, key, model, method, args = [], kwargs = {}) {
  const res = await fetch(`${base}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [db, uid, key, model, method, args, kwargs],
      },
      id: ++rpcId,
    }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error.data?.message || json.error.message || "Odoo error";
    throw new Error(msg);
  }
  return json.result;
}

// Friendly labels for the BFA-custom fields on event.registration.
// Field names are Odoo Studio auto-generated technical names — mapped here so
// the frontend never has to know them.
const REG_STUDIO_FIELDS = {
  player: "x_studio_many2one_field_tj_1iimhapea",
  childFullName: "x_studio_child_full_name",
  parentName: "x_studio_parent_name",
  invoiced: "x_studio_invoiced",
  documentsSent: "x_studio_documents_sent",
  embassyAppointment: "x_studio_embassy_appointment",
  medicalCondition: "x_studio_medical_condition",
  specialCondition: "x_studio_special_condition",
  extraNotes: "x_studio_extra_notes",
  campPeriod: "x_studio_camp_period",
};

function mapRegistration(r) {
  const player = r[REG_STUDIO_FIELDS.player];
  return {
    id: r.id,
    playerId: player ? player[0] : null,
    playerName: (player && player[1]) || r[REG_STUDIO_FIELDS.childFullName] || r.name || "(unnamed)",
    parentName: r[REG_STUDIO_FIELDS.parentName] || "",
    email: r.email || "",
    phone: r.phone || "",
    state: r.state,
    invoiced: !!r[REG_STUDIO_FIELDS.invoiced],
    documentsSent: !!r[REG_STUDIO_FIELDS.documentsSent],
    embassyAppointment: !!r[REG_STUDIO_FIELDS.embassyAppointment],
    medicalCondition: r[REG_STUDIO_FIELDS.medicalCondition] || "",
    specialCondition: r[REG_STUDIO_FIELDS.specialCondition] || "",
    notes: r[REG_STUDIO_FIELDS.extraNotes] || "",
    campPeriod: r[REG_STUDIO_FIELDS.campPeriod] || "",
  };
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, x-bfa-pin");
}

exports.bfaEvents = onRequest(
  { secrets: [ODOO_URL, ODOO_DB, ODOO_KEY, ODOO_UID, STAFF_PIN], cors: false },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.headers["x-bfa-pin"] !== STAFF_PIN.value()) {
      res.status(401).json({ error: "Missing or incorrect PIN" });
      return;
    }

    const base = ODOO_URL.value();
    const db = ODOO_DB.value();
    const uid = Number(ODOO_UID.value());
    const key = ODOO_KEY.value();

    try {
      const path = req.path.replace(/\/+$/, "");
      const rosterMatch = path.match(/^\/events\/(\d+)\/roster$/);

      if (path === "/events" || path === "") {
        const showAll = req.query.all === "1";
        const todayIso = new Date().toISOString().slice(0, 10);
        const domain = showAll ? [] : [["date_end", ">=", todayIso]];
        const events = await odooCall(base, db, uid, key, "event.event", "search_read", [domain], {
          fields: [
            "name",
            "date_begin",
            "date_end",
            "address_inline",
            "stage_id",
            "seats_reserved",
            "seats_max",
            "seats_used",
          ],
          order: "date_begin desc",
          limit: 200,
        });
        res.json({
          events: events.map((e) => ({
            id: e.id,
            name: e.name,
            dateBegin: e.date_begin,
            dateEnd: e.date_end,
            location: e.address_inline || "",
            stage: e.stage_id ? e.stage_id[1] : "",
            registered: e.seats_reserved,
            attended: e.seats_used,
            seatsMax: e.seats_max,
          })),
        });
        return;
      }

      if (rosterMatch) {
        const eventId = Number(rosterMatch[1]);
        const regs = await odooCall(base, db, uid, key, "event.registration", "search_read", [
          [["event_id", "=", eventId]],
        ], {
          fields: [
            "id",
            "name",
            "email",
            "phone",
            "state",
            ...Object.values(REG_STUDIO_FIELDS),
          ],
          order: "id asc",
          limit: 1000,
        });
        res.json({ registrations: regs.map(mapRegistration) });
        return;
      }

      res.status(404).json({ error: "Not found" });
    } catch (err) {
      console.error(err);
      res.status(502).json({ error: String(err.message || err) });
    }
  }
);
