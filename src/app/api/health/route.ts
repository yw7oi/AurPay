export const dynamic = "force-dynamic";

/* GET /api/health — public.py */
export async function GET() {
  return Response.json({ status: "ok", service: "urpay-backend" });
}
