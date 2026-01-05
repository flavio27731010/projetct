import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handle() {
    setLoading(true);
    setMsg(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) setMsg(error.message);
      } else {
  // ✅ permite criar conta APENAS com domínio @samarco.com
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail.endsWith("@samarco.com")) {
    setMsg("❌ Apenas e-mails com domínio @samarco.com podem criar conta.");
    return;
  }

  const { error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password: pass,
  });

  if (error) setMsg(error.message);
  else setMsg("✅ Conta criada! Agora faça login.");
  setMode("login");
}

    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: "0 auto" }}>
        <h1 className="h1">Login do usuário</h1>
        <p className="muted">RDO de turno - Laboratório Controle Geotecnico</p>

        <div className="hr" />

        <div className="row">
          <div className="col">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" />
          </div>
          <div className="col">
            <label>Senha</label>
            <input value={pass} type="password" onChange={(e) => setPass(e.target.value)} placeholder="********" />
          </div>
        </div>

        {msg && <p style={{ marginTop: 10 }}>{msg}</p>}

        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn secondary" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Criar conta" : "Já tenho conta"}
          </button>

          <button
            className="btn"
            disabled={loading}
            onClick={handle}
            style={{
              backgroundColor: mode === "signup" ? "#16a34a" : undefined, // ✅ verde no modo cadastro
              borderColor: mode === "signup" ? "#16a34a" : undefined,
            }}
          >
            {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Cadastrar"}
          </button>
        </div>

        {/* ✅ Texto no rodapé */}
        <p
          className="muted"
          style={{
            marginTop: 18,
            textAlign: "center",
            fontSize: 12,
            opacity: 0.7,
          }}
        >
          © 2026 - Flávio Assis
        </p>
      </div>
    </div>
  );
}
