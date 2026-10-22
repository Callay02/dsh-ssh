# Changelog

## [0.1.0] - 2026-10-22

Initial public release.

### Added

- SSH terminal as a right-sidebar tab, with the main conversation kept visible.
- Multiple connection profiles with password, private-key or SSH-agent authentication.
- TOFU host-key pinning and fingerprint display.
- Live remote status bar: connection state, download/upload throughput, CPU and memory.
- xterm.js terminal with resize, scrollback and multiple shells per connection.
- SFTP browser with upload, download, rename, delete and folder creation.
- Folder download as a streamed `.tar.gz` archive.
- Upload, download and archive progress bars with cancellation.
- Agent tools: `ssh_list`, `ssh_connect`, `ssh_exec`, `ssh_files`, `ssh_upload`, `ssh_download`.
- Automatic Chinese/English UI following the DSH locale setting.
- Authenticated DSH `/api` routes and restricted local paths for Agent transfers.

### Security

- Connection profiles and host fingerprints live in `$DSH_HOME/ssh/connections.json` with mode `0600`.
- Passwords are stored in plaintext protected by file permissions; private keys or an SSH agent are recommended.
- The plugin opens the SSH connection, never an additional network listener.

### Known limitations

- Terminal transport uses long polling rather than a duplex WebSocket.
- Connections and terminal scrollback do not survive a Host restart.
- No port forwarding, ProxyJump, key-management UI or sudo password prompt.
- Downloads are buffered in browser memory to report progress.
- The right sidebar requires an active DSH session.
