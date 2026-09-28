import { CITIES } from "@/lib/urpay-server/constants";

export const dynamic = "force-dynamic";

/* GET /api/cities — public.py */
export async function GET() {
  return Response.json({ cities: CITIES });
}
