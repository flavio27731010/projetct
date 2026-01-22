// src/lib/forceUpdate.ts

type ForceUpdateOptions = {
  // chave pra evitar loop de reload
  key?: string;
  // se true, faz limpeza só quando estiver online
  onlyWhenOnline?: boolean;
};

export async function forceUpdateApp(opts: ForceUpdateOptions = {}) {
  const key = opts.key ?? "FORCE_UPDATE_DONE_v1";
  const onlyWhenOnline = opts.onlyWhenOnline ?? true;

  try {
    // evita loop infinito
    if (sessionStorage.getItem(key) === "1") return;

    if (onlyWhenOnline && typeof navigator !== "undefined" && !navigator.onLine) {
      return;
    }

    // marca que já rodou nesta sessão
    sessionStorage.setItem(key, "1");

    // 1) apaga Cache Storage (onde o SW guarda assets)
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }

    // 2) remove service workers antigos
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }

    // 3) recarrega a página (pega arquivos novos do servidor)
    // usa replace para não voltar pro cache via back
    window.location.replace(window.location.href);
  } catch (err) {
    // se falhar, pelo menos tenta recarregar
    console.error("forceUpdateApp error:", err);
    window.location.reload();
  }
}
