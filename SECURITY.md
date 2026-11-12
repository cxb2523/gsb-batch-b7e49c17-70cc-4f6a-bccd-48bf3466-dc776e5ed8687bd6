# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Contact: Qarib, [qarib@quore.dev](mailto:qarib@quore.dev)

Include what you found, how to reproduce it, and which version or commit you used. We will try to answer promptly. Please give us reasonable time to fix a problem before you publish it.

## What is in scope

- The app and API in this repository.
- The encryption in the browser, the key handling, and the access rules between workspaces, projects and canvases.
- The Docker image and compose files.

Problems in a particular instance's own setup (a weak `AUTH_SECRET`, an exposed database, an open bucket) are the operator's to fix. We still want to hear about documentation that leads people there.

## What CanvHQ protects, and what it does not

Canvas content and images are encrypted in the browser, and the server does not hold a key that opens them. Names of workspaces, projects and canvases, member names and emails, who belongs to what, timestamps, sizes and sign-in data are stored as readable data.

The encrypting happens in the browser, using code the server sends to it, so a compromised or malicious server could send altered code. A compromised computer or browser can see what is typed. Someone removed from a workspace keeps what they already saw. A device detects a replayed older version only if it has already seen a newer one. A public link works for anyone who holds it. Keys of other members come from the server, and there is no key pinning yet.

The full description is on the Security page of the app and in the documentation ("How your data is protected").

## Supported versions

CanvHQ is pre-release. Fixes go into the current development branch.
