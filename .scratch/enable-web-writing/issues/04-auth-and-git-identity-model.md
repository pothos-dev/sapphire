# 04 — Auth & git-identity model

Type: grilling
Status: open
Blocked by: 01

## Question

Decide the concrete authentication model for web writing, and how an authenticated
user's identity maps to **git commit authorship**.

Resolve:

- Which auth approach (from ticket 01's survey) we adopt, and *why* it fits "few known
  users" + self-hosted + git-backed.
- Where the trust boundary is enforced — at the SvelteKit layer, the `/api` proxy hop,
  or inside axum — and how identity reaches the **write** routes specifically (reads
  stay open? or is the whole app gated?).
- The viewer-vs-editor consequence: is unauthenticated access a read-only viewer, or
  is everything behind login?
- How a request's identity becomes the commit **author** (name/email), and what the
  committer is.
- CSRF / token handling for the write routes.

This is the foundation the write-route surface (ticket 07) and git model (ticket 05)
build on. Record the decision under `## Answer`.
