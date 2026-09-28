import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { favoriteItem } from "@/lib/urpay-server/serializers";
import { digitsOnly } from "@/lib/urpay-server/validate";
import type { FavoriteRow } from "@/lib/urpay-server/types";

export const dynamic = "force-dynamic";

/* GET /api/favorites — favorites.py list_favorites (newest first) */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const db = getDb();

    const out = db.favorites
      .filter((f) => f.user_id === user.id)
      .sort((a, b) => b.created_at - a.created_at)
      .flatMap((fav) => {
        const target = db.users.find((u) => u.id === fav.target_user_id);
        return target ? [favoriteItem(fav, target)] : [];
      });
    return jsonOk(out);
  });
}

/* POST /api/favorites — favorites.py add_favorite */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<{ card_number?: unknown }>(req);
    const user = getAuthUser(req);
    const db = getDb();

    const cardRaw = typeof body.card_number === "string" ? body.card_number : "";
    const card = digitsOnly(cardRaw);
    const target = db.users.find((u) => u.card_number === card);
    if (!target) {
      return err(404, "المستخدم غير موجود");
    }
    if (target.id === user.id) {
      return err(405, "ما تصير تضيف نفسك للمفضلة 😅");
    }

    const exists = db.favorites.find(
      (f) => f.user_id === user.id && f.target_user_id === target.id,
    );
    if (exists) {
      return jsonOk({
        message: "هذا موجود بالمفضلة أصلًا",
        favorite: favoriteItem(exists, target),
      });
    }

    const fav: FavoriteRow = {
      id: ++db.seq.favorites,
      user_id: user.id,
      target_user_id: target.id,
      created_at: Date.now(),
    };
    db.favorites.push(fav);
    return jsonOk(
      {
        message: "تمت الإضافة للمفضلة ⭐",
        favorite: favoriteItem(fav, target),
      },
      201,
    );
  });
}
