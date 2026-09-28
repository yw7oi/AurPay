/* Legacy stub — the Python backend spawner was removed in the pure-Next.js
 * port. Exists only so old copies of this file are overwritten cleanly by
 * the 3.zip overlay. */
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { detail: "طريقة مهجورة — أور پاي أصبح Next.js خالصًا" },
    { status: 404 },
  );
}
