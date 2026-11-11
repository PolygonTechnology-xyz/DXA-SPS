export function cors(headers: Headers = new Headers()): Headers {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  return headers;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors(new Headers({ "Content-Type": "application/json" })),
  });
}
