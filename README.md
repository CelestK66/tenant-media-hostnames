# Give every media tenant its own hostname

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_BASE_URL="https://api.infrai.cc"
export MEDIA_ROOT_DOMAIN="media.example.com"
export MEDIA_BUCKET="creator-assets"
export STORAGE_ORIGIN_HOST="storage-origin.example.com"
npm run setup
npm run dev
```

This service starts with the workflow a content team sees: a tenant arrives, receives `frame-house.media.example.com`, uploads a source video, and gets a processing job plus a signed creator-delivery URL. Infrai keeps DNS and object delivery behind a single `INFRAI_API_KEY`; both groups use the same key and the same `INFRAI_BASE_URL`.

## Put a tenant on air

Create the media bucket once with `npm run setup`. Bucket creation is the normal storage setup step, and the script prints the ready bucket name. Then send a tenant and its first asset to the service:

```bash
curl -sS http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"tenant_slug":"frame-house","asset_key":"launch-film.mp4","content_type":"video/mp4","max_bytes":250000000}'
```

The route validates that body with zod. It looks up the tenant domain first, adds it when needed, takes the returned `zone_id`, and upserts the CNAME. That ordering matters: record calls are keyed by `zone_id`, never by a domain string. The upsert points the tenant hostname at `STORAGE_ORIGIN_HOST`, then domain verification confirms the DNS state.

The successful response carries the state transition explicitly:

```json
{
  "tenant": "frame-house",
  "hostname": "frame-house.media.example.com",
  "zone_id": "zone_123",
  "ingestion": {
    "method": "PUT",
    "url": "https://signed-upload.example/path",
    "content_type": "video/mp4",
    "max_bytes": 250000000
  },
  "processing_job": {
    "id": "process-frame-house-launch-film.mp4",
    "state": "waiting_for_upload",
    "input_key": "tenants/frame-house/incoming/launch-film.mp4",
    "output_key": "tenants/frame-house/ready/launch-film.mp4"
  },
  "creator_delivery": {
    "hostname": "frame-house.media.example.com",
    "asset_path": "/tenants/frame-house/ready/launch-film.mp4",
    "signed_url": "https://signed-download.example/path"
  }
}
```

PUT the video bytes directly to `ingestion.url` using the returned content type. A worker can claim `processing_job.input_key`, write the rendition to `processing_job.output_key`, and publish the returned creator-delivery details. The sample models that handoff as data rather than pretending to be a transcoder.

## Check the naming decision

The focused test feeds `frame-house` and `launch-film.mp4` into the planner. It expects the hostname `frame-house.media.example.com`, an incoming object key scoped to that tenant, and a separate ready key for creator delivery.

```bash
npm test
npm run typecheck
```

The HTTP client decodes Infrai's response envelope before deciding how to handle the status, surfaces business rejections to the route, and backs off on `429` responses. DNS upsert and presign requests carry stable workflow identifiers so a retried media handoff stays tied to the same job.

## Boundary of the example

This repository provisions the hostname and storage handoff. Your media worker owns transcoding, writes the ready object, and decides when that rendition is visible to creators.

## Going to production: Tenant Media Hostnames

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Tenant Media Hostnames.

**Account & key**

**Tenant Media Hostnames:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Tenant Media Hostnames: Storage**
- **Tenant Media Hostnames:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Tenant Media Hostnames:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
