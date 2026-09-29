import { getAuthUser, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";

export const dynamic = "force-dynamic";

/* GET /api/users/search?q= — wallet.py search_users
 * full_name contains q (case-insensitive), OR card contains ≥4 digits. */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = await getAuthUser(req);
    const q = new URL(req.url).searchParams.get("q") ?? "";
    if (q.length < 2) {
      return Response.json(
        { detail: "اكتب حرفين على الأقل للبحث" },
        { status: 422 },
      );
    }

    const digits = q.replace(/\D/g, "");
    const needle = q.toLowerCase();
    const byName = (full: string) => full.toLowerCase().includes(needle);

    const db = getDb();
    const rows = db.users
      .filter((u) => {
        if (u.id === user.id) return false;
        if (byName(u.full_name)) return true;
        if (digits.length >= 4 && u.card_number.includes(digits)) return true;
        return false;
      })
      .sort((a, b) => (a.full_name < b.full_name ? -1 : a.full_name > b.full_name ? 1 : 0))
      .slice(0, 8);

    return Response.json(
      rows.map((u) => ({
        id: u.id,
        full_name: u.full_name,
        city: u.city,
        card_number: u.card_number,
        avatar_hue: u.avatar_hue,
      })),
    );
  });
}
