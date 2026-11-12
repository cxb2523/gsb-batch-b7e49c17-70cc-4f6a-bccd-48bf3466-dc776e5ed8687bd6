# How your data is protected

CanvHQ encrypts what you draw in your browser before it is saved. The server stores the encrypted result and does not hold a key that opens it.

## What is encrypted

- The content of a canvas: shapes, text and settings.
- The images on a canvas.

Only people you let into a workspace can open its canvases, and each person opens them with their own passphrase.

## What is not end-to-end encrypted

To coordinate collaboration and serve the app, the server stores the following as readable data. It needs to read these details so it can list your canvases, show who belongs to a workspace, check what each person is allowed to open, deliver invitations and keep you signed in, all without opening your canvases. Access to them is limited by your role in the workspace.

- Names of workspaces, projects and canvases.
- Names and email addresses of members, who belongs to which workspace and project, and their roles.
- Dates and sizes.
- Sign-in data: the session record, with the browser and IP address of each sign-in.

## What you need to do

Keep your passphrase. We cannot reset it. If you lose it, your canvases cannot be opened.

## The limits

- The encrypting happens in your browser, using code that the server sends to it. If that server were compromised or run by someone malicious, it could send your browser altered code that captures what you type. This is a limit of every web app.
- If your own computer or browser is compromised, for example by malware or a harmful extension, it can see what you type and what is on your screen, before and after encryption.
- Someone you remove from a workspace keeps what they already saw or copied, but not future content. Rotation protects what is saved afterwards.
- If the server hands back an older saved version, your device notices only if it has already seen a newer one. A brand-new device cannot tell.
- A public link works for anyone who has it until you turn it off.
- The public keys of other members come from the server. A malicious server could swap one when someone is invited. There is no key pinning yet.

The Security page in the app says the same in the same words.

## Where things live

| What | Where |
| :--- | :--- |
| Accounts, workspaces, projects, members, roles, canvas list, wrapped keys | PostgreSQL |
| Encrypted canvases and images | Your S3-compatible bucket |
| Unlocked keys on your device | Your browser, kept so other scripts cannot read the key bytes, and cleared when you sign out |

<details>
<summary>Technical details</summary>

**Passphrase.** The browser derives a 256-bit key from your passphrase with PBKDF2 (SHA-256, 600,000 iterations, a random 16-byte salt). That key wraps your RSA-OAEP (2048-bit) private key. The server stores the wrapped private key and the public key.

**Key layers.** Each layer wraps the one below it, and only wrapped keys are sent to the server:

1. The workspace key (AES-GCM, 256-bit) is wrapped with the public key of each administrator.
2. A project key is wrapped with the workspace key, or with the public key of a member who was given that project.
3. A canvas key is wrapped with the project key.
4. The canvas and each of its images are encrypted with the canvas key.
5. Older project keys are wrapped under newer ones, so a keyholder can open canvases saved under earlier keys.

**Bound to its place.** Every saved blob starts with a version byte and the key versions and revision, and these, together with the ids of the workspace, project, canvas and person, are part of the authenticated data of the encryption. A blob copied to another canvas or version does not open.

**Replay.** Each canvas has a revision that increases with every save. A device keeps the highest revision it has seen and refuses a payload that goes backwards.

**Objects.** `boards/{boardId}/v{keyVersion}.bin` for a canvas, `boards/{boardId}/v{keyVersion}/files/{fileId}.bin` for an image.

**Public links.** The link carries a server token and the canvas key in the part after `#`, which browsers do not send to the server.

**Rotation.** When an administrator is removed or demoted, the workspace key rotates first, then each project key under it. Canvases are saved again under the new key, with their images, by an administrator's browser. Canvases with an active public link keep their key until the link is turned off.

</details>
