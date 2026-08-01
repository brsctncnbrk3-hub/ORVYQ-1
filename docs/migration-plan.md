# Historical migration plan — not active production guidance

> This document previously described the repository’s transition from an older proof/full architecture. It is retained in Git history for archaeology, but it no longer defines ORVYQ behaviour.
>
> The authoritative production contract is [`../ORVYQ_SYSTEM.md`](../ORVYQ_SYSTEM.md).

The former migration plan assumed a separate 150-second proof, proof approval records and proof/full frame-range branching. Those assumptions have been superseded.

The active system now uses:

**one complete canonical timeline → 720p Full-Length Review → explicit user approval → 1080p Final Encode**

Project `002-the-new-war-beneath-the-ocean` is the live acceptance test. Any remaining code, schema, workflow or documentation that depends on the retired proof architecture is technical debt and must be corrected against `ORVYQ_SYSTEM.md`.

The complete former migration plan remains available in repository history at commit `4cb78039cc4acf06ac2d9bb22c89ab3e8c17e5a0` and earlier revisions.
