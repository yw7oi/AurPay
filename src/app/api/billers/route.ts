import { BILLERS, CATEGORIES } from "@/lib/urpay-server/constants";

export const dynamic = "force-dynamic";

/* GET /api/billers — public.py */
export async function GET() {
  return Response.json({
    categories: CATEGORIES,
    billers: BILLERS,
  });
}
