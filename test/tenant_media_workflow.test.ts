import assert from "node:assert/strict";
import test from "node:test";
import { planTenantMedia, tenantRequestSchema } from "../src/tenant_media_workflow.js";

test("keeps each creator tenant in its own hostname and object prefix", () => {
  const input = tenantRequestSchema.parse({
    tenant_slug: "frame-house",
    asset_key: "launch-film.mp4",
    content_type: "video/mp4",
    max_bytes: 250_000_000,
  });

  assert.deepEqual(planTenantMedia(input, "media.example.com"), {
    hostname: "frame-house.media.example.com",
    inputKey: "tenants/frame-house/incoming/launch-film.mp4",
    outputKey: "tenants/frame-house/ready/launch-film.mp4",
    jobId: "process-frame-house-launch-film.mp4",
  });
});
