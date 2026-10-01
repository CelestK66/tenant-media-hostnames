import { z } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.js";

export const tenantRequestSchema = z.object({
  tenant_slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  asset_key: z.string().min(1).max(512).refine((key) => !key.startsWith("/")),
  content_type: z.string().min(1),
  max_bytes: z.number().int().positive().max(5_000_000_000),
});

export type TenantRequest = z.infer<typeof tenantRequestSchema>;

type DomainData = { zone_id: string };
type PresignData = { url: string };

export type TenantMediaPlan = {
  tenant: string;
  hostname: string;
  zone_id: string;
  ingestion: { method: "PUT"; url: string; content_type: string; max_bytes: number };
  processing_job: { id: string; state: "waiting_for_upload"; input_key: string; output_key: string };
  creator_delivery: { hostname: string; asset_path: string; signed_url: string };
};

export function planTenantMedia(input: TenantRequest, rootDomain: string) {
  const hostname = `${input.tenant_slug}.${rootDomain}`;
  const inputKey = `tenants/${input.tenant_slug}/incoming/${input.asset_key}`;
  const outputKey = `tenants/${input.tenant_slug}/ready/${input.asset_key}`;
  const jobId = `process-${input.tenant_slug}-${encodeURIComponent(input.asset_key)}`;
  return { hostname, inputKey, outputKey, jobId };
}

export class TenantMediaWorkflow {
  private readonly infrai: InfraiClient;
  private readonly rootDomain: string;
  private readonly bucket: string;
  private readonly storageOrigin: string;

  constructor(
    infrai: InfraiClient,
    rootDomain: string,
    bucket: string,
    storageOrigin: string,
  ) {
    this.infrai = infrai;
    this.rootDomain = rootDomain;
    this.bucket = bucket;
    this.storageOrigin = storageOrigin;
  }

  async provision(input: TenantRequest): Promise<TenantMediaPlan> {
    const plan = planTenantMedia(input, this.rootDomain);
    const domain = await this.findOrAddDomain(plan.hostname, input.tenant_slug);

    await this.infrai.request("PUT", "/v1/dns/record/upsert", {
      zone_id: domain.zone_id,
      record_type: "CNAME",
      name: "@",
      content: this.storageOrigin,
      ttl: 300,
      proxied: true,
      metadata: { tenant_slug: input.tenant_slug, purpose: "creator-media-delivery" },
    });

    await this.infrai.request("POST", "/v1/dns/domain/verify", {
      domain: plan.hostname,
    });

    const upload = await this.presign(plan.inputKey, {
      op: "put",
      expires_seconds: 900,
      content_type: input.content_type,
      max_bytes: input.max_bytes,
      idempotency_key: `${plan.jobId}-upload`,
    });
    const download = await this.presign(plan.outputKey, {
      op: "get",
      expires_seconds: 3_600,
      response_disposition: "inline",
      idempotency_key: `${plan.jobId}-delivery`,
    });

    return {
      tenant: input.tenant_slug,
      hostname: plan.hostname,
      zone_id: domain.zone_id,
      ingestion: {
        method: "PUT",
        url: upload.url,
        content_type: input.content_type,
        max_bytes: input.max_bytes,
      },
      processing_job: {
        id: plan.jobId,
        state: "waiting_for_upload",
        input_key: plan.inputKey,
        output_key: plan.outputKey,
      },
      creator_delivery: {
        hostname: plan.hostname,
        asset_path: `/${plan.outputKey}`,
        signed_url: download.url,
      },
    };
  }

  private async findOrAddDomain(hostname: string, tenantSlug: string): Promise<DomainData> {
    const query = new URLSearchParams({ domain: hostname });
    try {
      return await this.infrai.request<DomainData>("GET", `/v1/dns/domain/get?${query}`);
    } catch (error) {
      if (!(error instanceof InfraiError) || error.status >= 500) throw error;
    }

    try {
      return await this.infrai.request<DomainData>("POST", "/v1/dns/domain/add", {
        domain: hostname,
        metadata: { tenant_slug: tenantSlug, purpose: "creator-media-delivery" },
      });
    } catch (error) {
      if (!(error instanceof InfraiError)) throw error;
      return this.infrai.request<DomainData>("GET", `/v1/dns/domain/get?${query}`);
    }
  }

  private presign(key: string, body: Record<string, unknown>) {
    const bucket = encodeURIComponent(this.bucket);
    const objectKey = key.split("/").map(encodeURIComponent).join("/");
    return this.infrai.request<PresignData>(
      "POST",
      `/v1/storage/object/presign/${bucket}/${objectKey}`,
      body,
    );
  }
}
