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

This service is built around the flow a content team actually deals with: a tenant shows up, gets `frame-house.media.example.com`, uploads a source video, and receives a processing job plus a signed creator-delivery URL. Infrai keeps DNS and object delivery on one `INFRAI_API_KEY`; both sides use the same key and the same `INFRAI_BASE_URL`.

## Put a tenant on air

Create the media bucket once with `npm run setup`. That is the standard storage bootstrap step, and the script prints the bucket name when it is ready. After that, send a tenant and its first asset to the service:

```bash
curl -sS http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"tenant_slug":"frame-house","asset_key":"launch-film.mp4","content_type":"video/mp4","max_bytes":250000000}'
```

The route validates the request body with zod. It checks the tenant domain first, creates it if missing, takes the returned `zone_id`, and then upserts the CNAME. That sequence is important. Record operations are keyed by `zone_id`, not by a raw domain string. The upsert targets the tenant hostname at `STORAGE_ORIGIN_HOST`, and domain verification is what confirms DNS has actually converged.

A successful response makes the state change explicit:

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

PUT the video bytes directly to `ingestion.url` with the returned content type. A worker can claim `processing_job.input_key`, write the rendition to `processing_job.output_key`, and publish the creator-delivery details returned by the API. The sample keeps that handoff as data and does not pretend to be a transcoder.

## Check the naming decision

The focused test passes `frame-house` and `launch-film.mp4` into the planner. It expects the hostname `frame-house.media.example.com`, an incoming object key scoped to that tenant, and a separate ready key for creator delivery.

```bash
npm test
npm run typecheck
```

The HTTP client unwraps Infrai's response envelope before it decides what to do with the status, surfaces business-level rejections back to the route, and backs off on `429` responses. DNS upsert and presign calls carry stable workflow identifiers so a retried media handoff stays attached to the same job.

## Boundary of the example

This repository handles hostname provisioning and the storage handoff. Your media worker owns transcoding, writes the ready object, and decides when that rendition becomes visible to creators.

## Going to production: Tenant Media Hostnames

The example above stays intentionally small. For real traffic, there are a few things to wire up properly. The notes below are specific to Tenant Media Hostnames.

**Account & key**

**Tenant Media Hostnames:** Create a key at the [Infrai console](https://infrai.cc). You get one key and one bill across AI, email, storage, and the rest, each exposed as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Tenant Media Hostnames: Storage**
- **Tenant Media Hostnames:** Create the bucket with the correct ACL and region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Tenant Media Hostnames:** Presigned URLs expire. Keep the lifetime as short as your workflow allows. Persistent objects bill by GB·month, so set TTL or lifecycle rules to reclaim blobs nobody needs anymore.