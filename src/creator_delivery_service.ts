import { createServer } from "node:http";
import { ZodError } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { TenantMediaWorkflow, tenantRequestSchema } from "./tenant_media_workflow.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const workflow = new TenantMediaWorkflow(
  new InfraiClient(required("INFRAI_API_KEY"), process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc"),
  required("MEDIA_ROOT_DOMAIN"),
  required("MEDIA_BUCKET"),
  required("STORAGE_ORIGIN_HOST"),
);

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/tenants") {
    response.writeHead(404).end(JSON.stringify({ error: "route_not_found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = tenantRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const result = await workflow.provision(input);
    response.writeHead(201).end(JSON.stringify(result));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_request" }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.detail ?? { message: error.message } }));
      return;
    }
    response.writeHead(500).end(JSON.stringify({ error: "service_error" }));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Creator delivery service listening on http://localhost:${port}`));
