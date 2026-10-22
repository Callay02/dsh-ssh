# Privacy and commit checks

This project is developed in public. It must never contain a user's real SSH
connection details, credentials, OS account name, home path, host name, private
IP address, host-key fingerprint, or an unredacted screenshot.

## Rules

- Do not commit `connections.json`, private keys, `.env` files, password files,
  terminal logs, or anything under a test screenshot directory.
- Use demo values in documentation and tests: `demo`, `demo@server`,
  `127.0.0.1`, `verify-local`.
- Redact screenshots before adding them:
  - account name and avatar;
  - terminal prompt / host name;
  - connection username and any user-specific path;
  - host-key fingerprint.
- Do not put real server names, IP addresses or credentials in commit messages.
- The public GitHub owner URL is allowed; it identifies the hosting account, not
  a connection or an OS user. Do not add any other personal URL or email.

## Automated gates

The repository contains two local hooks and a CI workflow.

### Local hooks

Enable them once per clone:

```sh
git config core.hooksPath .githooks
```

Then:

- `.githooks/pre-commit` runs `scripts/check-privacy.sh --staged`.
- `.githooks/commit-msg` runs the same checker against the commit message.

Run the full check manually at any time:

```sh
sh scripts/check-privacy.sh --all
```

The checker:

- rejects forbidden paths (`connections.json`, `.env`, key files, test shots,
  `node_modules`);
- scans text for OS account names, home paths, known host names, server
  identifiers and fingerprints;
- requires every image to match a reviewed SHA-256 hash in
  `privacy/approved-images.txt`;
- rejects a commit message containing the same identifiers.

### Screenshot approval

After a screenshot has been visually reviewed and redacted, record its hash:

```sh
shasum -a 256 docs/screenshots/my-shot.png
```

Add the line `<hash>  docs/screenshots/my-shot.png` to
`privacy/approved-images.txt`. Any new or changed image without an approved hash
fails the hook and CI. This prevents an unredacted screenshot from being
committed by accident.

### CI

`.github/workflows/privacy.yml` runs the full check on every push and pull
request. Fix a failing check before merging or publishing.

## Git identity

Commit author metadata is intentionally generic in this repository:
`dsh-ssh <dsh-ssh@users.noreply.github.com>`. Use a generic identity for future
commits if you do not want your personal name or email attached to them.

The repository owner account remains visible on GitHub; a public repository
cannot hide its owner.
