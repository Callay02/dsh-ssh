#!/bin/sh
# Block personal data from entering a commit or the published tree.
#
# Modes:
#   --staged        inspect the index (used by .githooks/pre-commit)
#   --all           inspect HEAD (used by CI)
#   --message FILE  inspect a commit message (used by .githooks/commit-msg)
set -eu

MODE=${1:---staged}
case "$MODE" in
  --all|--staged|--message) ;;
  *) echo "usage: $0 [--all|--staged|--message <file>]" >&2; exit 2 ;;
esac

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

# Keep this list focused on actual identifiers, not generic words. The public
# repository owner URL is intentionally allowed; OS usernames and host data are
# not. `callay` only matches when it is not followed by a digit, so a GitHub
# handle such as Callay02 is not rejected.
PATTERN='callay([^0-9A-Za-z]|$)|MacBook|/Users/|TQJH|134\.122|oqxz|11e0f8d7'

if command -v shasum >/dev/null 2>&1; then
  HASH='shasum -a 256'
else
  HASH='sha256sum'
fi

failed=0

if [ "$MODE" = "--message" ]; then
  MESSAGE=${2:?usage: $0 --message <file>}
  if grep -IqE -i "$PATTERN" "$MESSAGE"; then
    echo "privacy: commit message contains personal information" >&2
    grep -inE -i "$PATTERN" "$MESSAGE" >&2 || true
    exit 1
  fi
  echo "privacy: commit message clean"
  exit 0
fi

if [ "$MODE" = "--staged" ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
  show() { git show ":$1"; }
else
  files=$(git ls-files)
  show() { git show "HEAD:$1"; }
fi

for file in $files; do
  case "$file" in
    scripts/check-privacy.sh|privacy/approved-images.txt)
      continue
      ;;
  esac

  case "$file" in
    connections.json|*/.env|.env|.env.*|.npmrc|*/.npmrc|*.pem|*.key|*.p12|id_rsa|id_ed25519|test/shots/*|node_modules/*|.DS_Store)
      echo "privacy: forbidden file path: $file" >&2
      failed=1
      continue
      ;;
  esac

  case "$file" in
    *.png|*.jpg|*.jpeg|*.webp|*.gif)
      actual=$(show "$file" | $HASH | awk '{print $1}')
      expected=$(awk -v f="$file" '$2==f {print $1}' privacy/approved-images.txt)
      if [ -z "$expected" ]; then
        echo "privacy: image $file has no approved hash; redact it and update privacy/approved-images.txt" >&2
        failed=1
      elif [ "$actual" != "$expected" ]; then
        echo "privacy: image $file changed; review redaction and update privacy/approved-images.txt" >&2
        failed=1
      fi
      continue
      ;;
  esac

  if show "$file" | grep -IqE -i "$PATTERN"; then
    echo "privacy: personal information found in $file" >&2
    show "$file" | grep -inE -i "$PATTERN" | head -3 >&2 || true
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "privacy: commit blocked" >&2
  exit 1
fi

echo "privacy: clean"
