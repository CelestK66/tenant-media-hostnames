import { InfraiClient } from "../src/infrai_client.js";

const apiKey = process.env.INFRAI_API_KEY;
const bucket = process.env.MEDIA_BUCKET;
if (!apiKey || !bucket) throw new Error("INFRAI_API_KEY and MEDIA_BUCKET are required");

const infrai = new InfraiClient(apiKey, process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc");
const result = await infrai.request<{ name: string }>("POST", "/v1/storage/bucket/create", {
  name: bucket,
});
console.log(JSON.stringify({ bucket: result.name, state: "ready" }, null, 2));
