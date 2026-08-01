export const CANONICAL_VISUAL_ROLES = Object.freeze([
  "evidence",
  "archive",
  "context",
  "human_context",
  "metaphor",
  "graphic",
]);

const CANONICAL_ROLE_SET = new Set(CANONICAL_VISUAL_ROLES);

// Editorial/acquisition layers may use more descriptive labels. Those labels
// must never leak into the canonical edit plan consumed by schemas and the
// renderer. Keep every alias project-independent and map it to the smallest
// truthful canonical role rather than expanding renderer vocabulary for one
// topic or one film.
export const EDITORIAL_VISUAL_ROLE_ALIASES = Object.freeze({
  governance_context: "context",
  scientific_context: "context",
});

export function canonicalVisualRole(role, { allowEditorialAliases = true } = {}) {
  const value = String(role || "").trim();
  if (CANONICAL_ROLE_SET.has(value)) return value;
  if (allowEditorialAliases && EDITORIAL_VISUAL_ROLE_ALIASES[value]) {
    return EDITORIAL_VISUAL_ROLE_ALIASES[value];
  }
  throw new Error(
    `Unsupported visual role ${value || "<missing>"}; expected one of ${CANONICAL_VISUAL_ROLES.join(", ")}`
  );
}

export function isCanonicalVisualRole(role) {
  return CANONICAL_ROLE_SET.has(String(role || "").trim());
}
