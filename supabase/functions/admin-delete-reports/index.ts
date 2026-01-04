import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  try {
    // ✅ somente POST
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ✅ senha enviada pelo app
    const { password, reportIds, mode } = await req.json();

    // ✅ senha secreta no Supabase
    const adminPassword = Deno.env.get("ADMIN_DELETE_PASSWORD");

    if (!adminPassword) {
      return new Response(
        JSON.stringify({ error: "ADMIN_DELETE_PASSWORD não configurada" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ valida senha
    if (!password || password !== adminPassword) {
      return new Response(JSON.stringify({ error: "Senha inválida" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ✅ client com service role (ignora RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ✅ apagar tudo
    if (mode === "ALL") {
      await supabase.from("activities").delete().neq("id", "");
      await supabase.from("pendings").delete().neq("id", "");
      await supabase.from("reports").delete().neq("id", "");

      return new Response(JSON.stringify({ ok: true, deleted: "ALL" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ✅ apagar selecionados
    if (mode === "IDS") {
      if (!Array.isArray(reportIds) || reportIds.length === 0) {
        return new Response(JSON.stringify({ error: "reportIds obrigatórios" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      await supabase.from("activities").delete().in("report_id", reportIds);
      await supabase.from("pendings").delete().in("report_id", reportIds);
      await supabase.from("reports").delete().in("id", reportIds);

      return new Response(JSON.stringify({ ok: true, deleted: reportIds.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "mode inválido (use ALL ou IDS)" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? "Erro desconhecido" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
