# Storage

CanvHQ keeps encrypted canvases and their images in object storage. Any service that speaks the S3 API works. Canvas content is encrypted in the browser before it is saved, and the server does not hold a key that opens it.

Names of workspaces, projects and canvases, and who belongs to what, are not in the bucket. They are in the database.

## What CanvHQ needs

| Variable | Meaning |
| :--- | :--- |
| `S3_BUCKET_NAME` | The bucket to use. If it does not exist, CanvHQ tries to create it on start. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | A key that can list, read, write and delete objects in that bucket. |
| `S3_ENDPOINT` | The address of the service. Leave empty if the S3 library's default is right for you. |
| `S3_REGION` | The region the service expects. |
| `S3_FORCE_PATH_STYLE` | `true` for services that put the bucket in the path (most self-hosted ones), `false` for services that put it in the host name. If you leave it out, CanvHQ guesses from the endpoint. |

Keep the bucket private. Browsers do not talk to the bucket: they send everything through CanvHQ.

Cloudflare R2 and AWS S3 are two services that offer an S3 API. Follow your provider's own documentation to create a bucket and a key, then use the values above. This guide does not repeat provider settings or terms, because they change.

Images are re-encoded to at most 2048 pixels on their longest side before they are encrypted; the original is not stored.

## For local development

`docker compose up` in the repository starts RustFS, a small S3-compatible server, on port 9000 with its console on 9001, and points the app at it. It is meant for trying things out on your own machine.

## What is stored

Each canvas is one encrypted object per version, and each image is its own encrypted object. Deleting a canvas, project or workspace removes the database rows at once and the objects shortly after, from a background job that retries until the storage answers.

<details>
<summary>Technical details</summary>

Object keys are `boards/{boardId}/v{keyVersion}.bin` for the canvas and `boards/{boardId}/v{keyVersion}/files/{fileId}.bin` for each image. Limits: 15 MB for one canvas upload, 8 MB for one image, 50 MB for one canvas in total, at most 100 images referenced by a canvas. When a project key rotates, canvases are re-saved under the new key version by an administrator's browser, and the old objects are queued for deletion once the new ones exist.

</details>
