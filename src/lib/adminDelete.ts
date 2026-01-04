import { supabase } from "./supabase";

export async function adminDeleteReportsByIds(password: string, reportIds: string[]) {
  const { data, error } = await supabase.functions.invoke("admin-delete-reports", {
    body: {
      password,
      mode: "IDS",
      reportIds,
    },
  });

  if (error) throw error;
  return data;
}
