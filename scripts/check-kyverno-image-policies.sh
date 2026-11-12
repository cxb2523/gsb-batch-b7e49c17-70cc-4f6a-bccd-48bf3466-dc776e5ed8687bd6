#!/usr/bin/env bash
#
# Verify the Kyverno image trust policies rendered from templates/kyverno/.
#
# The chart couples three checks, each controlled by its own switch:
#   - imageVerification  -> one *-signed-images Policy per ghcr.io/uug-ai image
#                           plus the audit-only trusted-registry Policy
#   - imageHardening     -> one *-hardened-images Policy per image
# A Policy is rendered only when its switch is enabled AND the cluster serves
# kyverno.io/v1. Every verification Policy takes its validationFailureAction
# from values (Audit|Enforce, enforced by values.schema.json); failurePolicy is
# fixed to Ignore and the webhook timeout covers remote Rekor/GHCR lookups.
#
# Coverage (all driven through `helm template`):
#   1. both switches on, kyverno.io/v1 present -> every expected Policy renders
#   2. both switches off                        -> zero Kyverno resources
#   3. switches on but kyverno.io/v1 absent     -> zero Kyverno resources
#   4. only imageVerification enabled           -> only signature + registry Policies
#   5. only imageHardening enabled              -> only hardening Policies
#   6. illegal validationFailureAction          -> helm template fails (schema)
#   7. Audit/Enforce propagate to every Policy; trusted-registry stays Audit
#   8. signature/hardening/registry rule contents
set -euo pipefail

HELM_BIN="${HELM_BIN:-helm}"
CHART_DIR="${1:-charts/hub}"
KYVERNO_DIR="$CHART_DIR/templates/kyverno"

# The expected per-image Policies, derived from the template files so the check
# tracks the chart instead of a hand-maintained list. basename keeps this
# portable across GNU and BSD/macOS find.
mapfile -t SIGNED_TEMPLATES < <(find "$KYVERNO_DIR" -name '*-signed-images.yaml' -type f | xargs -n1 basename | sort)
mapfile -t HARDENED_TEMPLATES < <(find "$KYVERNO_DIR" -name '*-hardened-images.yaml' -type f | xargs -n1 basename | sort)
SIGNED_COUNT="${#SIGNED_TEMPLATES[@]}"
HARDENED_COUNT="${#HARDENED_TEMPLATES[@]}"
# trusted-registry.yaml is the single audit-only registry Policy.
TOTAL_WITH_BOTH=$(( SIGNED_COUNT + HARDENED_COUNT + 1 ))

if (( SIGNED_COUNT == 0 || HARDENED_COUNT == 0 )); then
  echo "FAIL: no Kyverno templates found under $KYVERNO_DIR" >&2
  exit 1
fi

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# Render the chart to stdout. Extra args are passed through to helm.
render() { "$HELM_BIN" template hub "$CHART_DIR" "$@"; }

# Names of the Kyverno Policy resources present in a rendered manifest.
policy_names() {
  awk '
    /^---$/ { inpolicy=0; next }
    /^apiVersion: kyverno.io\/v1$/ { inpolicy=1 }
    inpolicy && /^  name: / { print $2 }
  ' | sort
}

# The full rendered block (document) of one named Policy.
policy_block() {
  local name="$1"
  awk -v name="$name" '
    /^---$/ { inblock=0; emit=0; next }
    /^apiVersion: kyverno.io\/v1$/ { inblock=1 }
    inblock && $0 == ("  name: " name) { emit=1 }
    inblock && emit { print }
  '
}

echo "Chart:      $CHART_DIR"
echo "Helm:       $("$HELM_BIN" version --short 2>/dev/null || echo "$HELM_BIN")"
echo "Templates:  $SIGNED_COUNT signature, $HARDENED_COUNT hardening, 1 trusted-registry"

###############################################################################
# 1. Both switches on + kyverno.io/v1 -> the complete Policy set renders.
###############################################################################
both="$(render --api-versions kyverno.io/v1 \
  --set imageVerification.enabled=true \
  --set imageHardening.enabled=true)"
names="$(printf '%s\n' "$both" | policy_names)"
got_count="$(printf '%s\n' "$names" | grep -c .)"
[[ "$got_count" == "$TOTAL_WITH_BOTH" ]] \
  || fail "both on: expected $TOTAL_WITH_BOTH Policies, got $got_count"

# Every expected signature/hardening Policy is present, and trusted-registry too.
for tpl in "${SIGNED_TEMPLATES[@]}" "${HARDENED_TEMPLATES[@]}"; do
  name="${tpl%.yaml}"
  grep -qx "$name" <<< "$names" || fail "both on: missing Policy $name"
done
grep -qx trusted-registry <<< "$names" || fail "both on: missing Policy trusted-registry"

# Nothing but namespaced kyverno.io/v1 Policy resources is generated.
[[ "$(printf '%s\n' "$both" | grep -c '^apiVersion: kyverno.io/v1$')" == "$TOTAL_WITH_BOTH" ]] \
  || fail "both on: kyverno.io/v1 document count mismatch"
[[ "$(printf '%s\n' "$both" | grep -c '^kind: Policy$')" == "$TOTAL_WITH_BOTH" ]] \
  || fail "both on: expected only namespaced Policy kinds"
if grep -q '^kind: ClusterPolicy$' <<< "$both"; then
  fail "both on: trusted-registry must be a namespaced Policy, not a ClusterPolicy"
fi
echo "OK (1/8): both switches on render all $TOTAL_WITH_BOTH Policies (namespaced Policy only)"

###############################################################################
# 2. Both switches off -> zero Kyverno resources, even with the API present.
###############################################################################
off="$(render --api-versions kyverno.io/v1)"
[[ "$(printf '%s\n' "$off" | grep -c 'kyverno.io/v1' || true)" == 0 ]] \
  || fail "switches off: Kyverno resources rendered despite disabled switches"
echo "OK (2/8): both switches off render zero Kyverno resources"

###############################################################################
# 3. Switches on but the cluster has no kyverno.io/v1 -> nothing renders.
###############################################################################
noapi="$(render \
  --set imageVerification.enabled=true \
  --set imageHardening.enabled=true)"
[[ "$(printf '%s\n' "$noapi" | grep -c 'kyverno.io/v1' || true)" == 0 ]] \
  || fail "no API: Kyverno resources rendered without kyverno.io/v1"
echo "OK (3/8): no kyverno.io/v1 API renders zero Kyverno resources"

###############################################################################
# 4 & 5. A single switch renders only its own Policies.
###############################################################################
only_verification="$(render --api-versions kyverno.io/v1 \
  --set imageVerification.enabled=true)"
only_hardening="$(render --api-versions kyverno.io/v1 \
  --set imageHardening.enabled=true)"

v_names="$(printf '%s\n' "$only_verification" | policy_names)"
h_names="$(printf '%s\n' "$only_hardening" | policy_names)"

# Verification switch: every signature Policy + trusted-registry, no hardening.
[[ "$(printf '%s\n' "$v_names" | grep -c .)" == $(( SIGNED_COUNT + 1 )) ]] \
  || fail "verification only: expected $(( SIGNED_COUNT + 1 )) Policies"
[[ "$(printf '%s\n' "$v_names" | grep -c -- '-hardened-images$' || true)" == 0 ]] \
  || fail "verification only: hardening Policies rendered"
[[ "$(printf '%s\n' "$v_names" | grep -c -- '-signed-images$')" == "$SIGNED_COUNT" ]] \
  || fail "verification only: signature Policy count mismatch"
grep -qx trusted-registry <<< "$v_names" \
  || fail "verification only: trusted-registry must render with imageVerification"

# Hardening switch: every hardening Policy, no signature Policy and no registry Policy.
[[ "$(printf '%s\n' "$h_names" | grep -c .)" == "$HARDENED_COUNT" ]] \
  || fail "hardening only: expected $HARDENED_COUNT Policies"
[[ "$(printf '%s\n' "$h_names" | grep -c -- '-signed-images$' || true)" == 0 ]] \
  || fail "hardening only: signature Policies rendered"
if grep -qx trusted-registry <<< "$h_names"; then
  fail "hardening only: trusted-registry must not render without imageVerification"
fi
[[ "$(printf '%s\n' "$h_names" | grep -c -- '-hardened-images$')" == "$HARDENED_COUNT" ]] \
  || fail "hardening only: hardening Policy count mismatch"
echo "OK (4/8): imageVerification alone -> $SIGNED_COUNT signature Policies + trusted-registry"
echo "OK (5/8): imageHardening alone -> $HARDENED_COUNT hardening Policies"

###############################################################################
# 6. Illegal validationFailureAction values fail at helm template (schema).
###############################################################################
for section in imageVerification imageHardening; do
  for bad in bogus enforce audit ""; do
    if render --api-versions kyverno.io/v1 \
        --set "$section.enabled=true" \
        --set "$section.validationFailureAction=$bad" >/dev/null 2>/tmp/kyverno-schema-err; then
      fail "schema accepted illegal $section.validationFailureAction='$bad'"
    fi
    grep -q "$section.validationFailureAction" /tmp/kyverno-schema-err \
      || fail "schema error for $section.validationFailureAction='$bad' did not mention the field"
  done
  # A non-boolean enabled must be rejected too.
  if render --api-versions kyverno.io/v1 \
      --set "$section.enabled=notabool" >/dev/null 2>/tmp/kyverno-schema-err; then
    fail "schema accepted non-boolean $section.enabled"
  fi
done
rm -f /tmp/kyverno-schema-err
echo "OK (6/8): illegal failure actions and non-boolean switches are rejected by values.schema.json"

###############################################################################
# 7. validationFailureAction is values-driven on every verification Policy;
#    trusted-registry is permanently Audit. failurePolicy is Ignore everywhere
#    and the webhook timeout is raised above the 10s default.
###############################################################################
for action in Audit Enforce; do
  manifest="$(render --api-versions kyverno.io/v1 \
    --set imageVerification.enabled=true \
    --set imageVerification.validationFailureAction="$action" \
    --set imageHardening.enabled=true \
    --set imageHardening.validationFailureAction="$action")"

  # The 46 image Policies follow the configured action; trusted-registry is
  # always Audit, so exclude its document from the configured-action count.
  action_regex="validationFailureAction: ${action}$"
  audit_regex='validationFailureAction: Audit$'
  image_docs="$(printf '%s\n' "$manifest" | awk '
    /^---$/ { skip=0; next }
    /^apiVersion: kyverno.io\/v1$/ { inpolicy=1 }
    inpolicy && /^  name: trusted-registry$/ { skip=1 }
    inpolicy && !skip { print }
  ')"
  action_count="$(printf '%s\n' "$image_docs" | grep -c -E "$action_regex")"
  [[ "$action_count" == $(( SIGNED_COUNT + HARDENED_COUNT )) ]] \
    || fail "action $action: not propagated to every image Policy (got $action_count)"
  # The trusted-registry document is the only Policy pinned to Audit.
  registry_audit_count="$(printf '%s\n' "$manifest" | awk '
    /^---$/ { inpolicy=0 }
    /^apiVersion: kyverno.io\/v1$/ { inpolicy=1 }
    inpolicy && /^  name: trusted-registry$/ { found=1 }
    found && /validationFailureAction: Audit$/ { c++ }
    END { print c+0 }
  ')"
  [[ "$registry_audit_count" == 1 ]] \
    || fail "action $action: trusted-registry must be the single Audit-pinned Policy (got $registry_audit_count)"

  while IFS= read -r name; do
    [[ "$name" == trusted-registry ]] && continue
    block="$(printf '%s\n' "$manifest" | policy_block "$name")"
    grep -q "validationFailureAction: $action$" <<< "$block" \
      || fail "$name does not use validationFailureAction $action"
    grep -q 'failurePolicy: Ignore$' <<< "$block" \
      || fail "$name: failurePolicy must be fixed to Ignore"
    grep -Eq 'webhookTimeoutSeconds: (3[0-9]|[4-9][0-9]|[0-9]{3,})$' <<< "$block" \
      || fail "$name: webhookTimeoutSeconds must cover remote verification (>10s)"
  done < <(printf '%s\n' "$manifest" | policy_names)

  # trusted-registry stays audit-only regardless of the configured action.
  registry="$(printf '%s\n' "$manifest" | policy_block trusted-registry)"
  grep -q 'validationFailureAction: Audit$' <<< "$registry" \
    || fail "trusted-registry must always be Audit"
  grep -q 'failurePolicy: Ignore$' <<< "$registry" \
    || fail "trusted-registry: failurePolicy must be Ignore"
done
echo "OK (7/8): Audit/Enforce propagate to all image Policies; trusted-registry stays Audit; failurePolicy Ignore; timeout 30s"

###############################################################################
# 8. Rule contents: keyless UUG.AI signature, image-hardening attestation and
#    the audit-only registry guard.
###############################################################################
enforce_manifest="$(render --api-versions kyverno.io/v1 \
  --set imageVerification.enabled=true --set imageVerification.validationFailureAction=Enforce \
  --set imageHardening.enabled=true --set imageHardening.validationFailureAction=Enforce)"

# 8a. Signature Policies bind the GitHub Actions issuer, the UUG.AI release
#     workflow and the image's own repository, and only match that image.
# The rendered subjectRegExp keeps its regex backslashes literally, so match
# the stable workflow identity as a fixed string.
workflow_identity='uug-ai/workflows/\.github/workflows/release-create\.yml@'
for tpl in "${SIGNED_TEMPLATES[@]}"; do
  name="${tpl%.yaml}"
  repo="uug-ai/${name%-signed-images}"
  block="$(printf '%s\n' "$enforce_manifest" | policy_block "$name")"
  grep -q 'issuer: https://token.actions.githubusercontent.com' <<< "$block" \
    || fail "$name: missing GitHub Actions issuer"
  grep -Fq "$workflow_identity" <<< "$block" \
    || fail "$name: not bound to the UUG.AI release-create workflow"
  grep -Fq 'release-create\.yml@(refs/.+|[0-9a-f]{40})' <<< "$block" \
    || fail "$name: workflow subject must accept a ref or a 40-char commit"
  grep -q "githubWorkflowRepository: $repo$" <<< "$block" \
    || fail "$name: signature not bound to repository $repo"
  grep -q "ghcr.io/$repo:" <<< "$block" \
    || fail "$name: imageReferences do not target ghcr.io/$repo"
  grep -q 'verifyImages:' <<< "$block" || fail "$name: missing verifyImages rule"
  if grep -q 'attestations:' <<< "$block"; then
    fail "$name: signature Policy must not carry attestations"
  fi
done

# 8b. Hardening Policies require the image-hardening/v1 attestation whose
#     predicate has result=passed and the image's own repository.
for tpl in "${HARDENED_TEMPLATES[@]}"; do
  name="${tpl%.yaml}"
  repo="uug-ai/${name%-hardened-images}"
  block="$(printf '%s\n' "$enforce_manifest" | policy_block "$name")"
  grep -q 'type: https://github.com/uug-ai/workflows/attestations/image-hardening/v1' <<< "$block" \
    || fail "$name: attestation type must be image-hardening/v1"
  grep -q 'issuer: https://token.actions.githubusercontent.com' <<< "$block" \
    || fail "$name: attestation not signed via the GitHub Actions keyless issuer"
  grep -Fq "$workflow_identity" <<< "$block" \
    || fail "$name: attestation not bound to the UUG.AI release-create workflow"
  grep -q "githubWorkflowRepository: $repo$" <<< "$block" \
    || fail "$name: attestation not bound to repository $repo"
  # Predicate conditions (Kyverno JMESPath, escaped from Helm in the template).
  grep -Fq 'key: "{{ result }}"' <<< "$block" \
    || fail "$name: missing predicate result condition"
  grep -Eq 'value: passed$' <<< "$block" \
    || fail "$name: predicate result must equal passed"
  grep -Fq 'key: "{{ repository }}"' <<< "$block" \
    || fail "$name: missing predicate repository condition"
  grep -q "value: $repo$" <<< "$block" \
    || fail "$name: predicate repository must equal $repo"
  grep -q 'attestations:' <<< "$block" || fail "$name: missing attestations check"
done

# 8c. trusted-registry only audits/denies non-ghcr.io/uug-ai images and never
#     performs signature verification itself.
registry="$(printf '%s\n' "$enforce_manifest" | policy_block trusted-registry)"
grep -q 'validationFailureAction: Audit$' <<< "$registry" \
  || fail "trusted-registry must be Audit so other registries are never blocked"
grep -q 'validate:' <<< "$registry" || fail "trusted-registry: missing validate rule"
grep -Fq 'value: "ghcr.io/uug-ai/*"' <<< "$registry" \
  || fail "trusted-registry: must allow ghcr.io/uug-ai/* images"
grep -q 'ephemeralContainers' <<< "$registry" \
  || fail "trusted-registry: must cover ephemeral containers too"
if grep -q 'verifyImages:' <<< "$registry"; then
  fail "trusted-registry must not verify signatures itself"
fi
echo "OK (8/8): signature, hardening and registry rules have the required bindings and predicates"

###############################################################################
# Lint the chart. helm lint has no --api-versions flag, so the Kyverno API
# gating is covered by the helm template cases above; lint still validates the
# values.schema.json constraints in both switch states.
###############################################################################
"$HELM_BIN" lint "$CHART_DIR" --quiet >/dev/null
"$HELM_BIN" lint "$CHART_DIR" --quiet \
  --set imageVerification.enabled=true --set imageVerification.validationFailureAction=Enforce \
  --set imageHardening.enabled=true --set imageHardening.validationFailureAction=Enforce >/dev/null
if "$HELM_BIN" lint "$CHART_DIR" --quiet \
    --set imageVerification.validationFailureAction=Block >/dev/null 2>/tmp/kyverno-lint-err; then
  fail "helm lint accepted an illegal validationFailureAction"
fi
rm -f /tmp/kyverno-lint-err
echo "OK: helm lint passes and rejects illegal failure actions via values.schema.json"

echo
echo "All Kyverno image policy checks passed."
