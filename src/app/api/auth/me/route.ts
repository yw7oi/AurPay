import { getAuthUser, runRoute } from "@/lib/urpay-server/http";
import { userPublic } from "@/lib/urpay-server/serializers";

export const dynamic = "force-dynamic";

/* GET /api/auth/me — auth.py */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = await getAuthUser(req);
    return Response.json(userPublic(user));
  });
}
