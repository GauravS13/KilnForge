import type { RouteHandler } from "../server.ts";

export const buildProofJsonRoute: RouteHandler = async () => {
  try {
    const file = Bun.file("build-proof.json");
    if (!(await file.exists())) {
      return new Response(
        JSON.stringify({ error: "build-proof.json not yet generated — run `bun run proof:build`" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(file, { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
