/**
 * In-memory stand-in for an Odoo server speaking the external JSON-RPC API
 * (/jsonrpc, services "common" and "object"), used to test the sync end to end.
 */
type Rec = Record<string, unknown> & { id: number };

export type FakeOdooData = {
  "account.move": Rec[];
  "res.partner": Rec[];
  "account.payment": Rec[];
  "res.company": Rec[];
};

function evalDomain(rec: Rec, domain: unknown[]): boolean {
  const stack: boolean[] = [];
  for (let i = domain.length - 1; i >= 0; i--) {
    const term = domain[i];
    if (term === "|") stack.push(stack.pop()! || stack.pop()!);
    else if (term === "&") stack.push(stack.pop()! && stack.pop()!);
    else {
      const [field, op, value] = term as [string, string, unknown];
      const v = rec[field] ?? false;
      let r: boolean;
      switch (op) {
        case "=": r = v === value; break;
        case "!=": r = v !== value; break;
        case "in": r = (value as unknown[]).includes(Array.isArray(v) ? v[0] : v); break;
        case ">=": r = v !== false && String(v) >= String(value); break;
        case "<=": r = v !== false && String(v) <= String(value); break;
        default: throw new Error(`fake odoo: unsupported operator ${op}`);
      }
      stack.push(r);
    }
  }
  return stack.every(Boolean);
}

export function fakeOdoo(data: FakeOdooData, opts: { apiKey?: string; failModels?: string[] } = {}) {
  const apiKey = opts.apiKey ?? "secret-key";
  const calls: { model: string; method: string }[] = [];
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const { service, method, args } = body.params;
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
    const fail = (name: string, message: string) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: 200, message: "Odoo Server Error", data: { name, message } } }), { status: 200 });

    if (service === "common" && method === "version") return reply({ server_version: "18.0+e", server_version_info: [18, 0, 0, "final", 0, "e"] });
    if (service === "common" && method === "authenticate") return reply(args[2] === apiKey ? 2 : false);
    if (service === "object" && method === "execute_kw") {
      const [, , key, model, m, posArgs, kw] = args as [string, number, string, keyof FakeOdooData, string, unknown[], Record<string, unknown>];
      if (key !== apiKey) return fail("odoo.exceptions.AccessDenied", "Access Denied");
      calls.push({ model, method: m });
      if (opts.failModels?.includes(model)) return fail("odoo.exceptions.AccessError", `You are not allowed to access ${model}`);
      const recs = data[model] ?? [];
      if (m === "fields_get") {
        const fields = new Set<string>(["id"]);
        recs.forEach((r) => Object.keys(r).forEach((k) => fields.add(k)));
        return reply(Object.fromEntries([...fields].map((f) => [f, { type: "char" }])));
      }
      const domain = (posArgs[0] as unknown[]) ?? [];
      const ctx = (kw.context as Record<string, unknown>) ?? {};
      const matching = recs.filter((r) => (ctx.active_test === false || r.active !== false) && evalDomain(r, domain)).sort((a, b) => a.id - b.id);
      if (m === "search") return reply(matching.map((r) => r.id));
      if (m === "search_read") {
        const offset = (kw.offset as number) ?? 0;
        const limit = (kw.limit as number) ?? matching.length;
        const fields = kw.fields as string[];
        return reply(matching.slice(offset, offset + limit).map((r) => Object.fromEntries([["id", r.id], ...fields.map((f) => [f, r[f] ?? false])])));
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls, apiKey };
}
