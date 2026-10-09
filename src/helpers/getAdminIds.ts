export function getAdminIds(): string[] {
  const ids = process.env.TELEGRAM_ADMIN_IDS
    ? process.env.TELEGRAM_ADMIN_IDS.split(",").map((id) => id.trim())
    : [process.env.TELEGRAM_ADMIN_ID || ""];
  return ids.filter((id) => /^\d+$/.test(id));
}
