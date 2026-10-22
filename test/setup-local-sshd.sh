#!/bin/sh
# Start or stop a throwaway OpenSSH server for plugin integration tests.
# Only listens on 127.0.0.1:2222 and authenticates with a generated key.
#
# macOS note: sshd must run outside the DSH file sandbox, otherwise its own
# sandbox_init fails with "Operation not permitted".
set -eu

DIR=${DSH_SSH_TEST_DIR:-/tmp/dsh-ssh-test}
ACTION=${1:-start}

stop() {
  if [ -f "$DIR/launcher.pid" ]; then
    PID=$(cat "$DIR/launcher.pid")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
    fi
    rm -f "$DIR/launcher.pid"
  fi
  echo "stopped $DIR"
}

if [ "$ACTION" = "stop" ]; then
  stop
  exit 0
fi

mkdir -p "$DIR"
if [ ! -f "$DIR/host_ed25519" ]; then
  ssh-keygen -q -t ed25519 -N '' -f "$DIR/host_ed25519"
fi
if [ ! -f "$DIR/client_ed25519" ]; then
  ssh-keygen -q -t ed25519 -N '' -f "$DIR/client_ed25519"
fi
cp "$DIR/client_ed25519.pub" "$DIR/authorized_keys"
chmod 600 "$DIR/authorized_keys"

cat > "$DIR/sshd_config" <<EOF
Port 2222
ListenAddress 127.0.0.1
HostKey $DIR/host_ed25519
PidFile $DIR/sshd.pid
AuthorizedKeysFile $DIR/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
UsePAM no
StrictModes no
Subsystem sftp /usr/libexec/sftp-server
LogLevel ERROR
EOF

if [ -f "$DIR/launcher.pid" ] && kill -0 "$(cat "$DIR/launcher.pid")" 2>/dev/null; then
  echo "already running on 127.0.0.1:2222"
  exit 0
fi

/usr/sbin/sshd -D -e -f "$DIR/sshd_config" > "$DIR/sshd.log" 2>&1 &
echo $! > "$DIR/launcher.pid"
sleep 1
if nc -z 127.0.0.1 2222 2>/dev/null; then
  echo "test sshd: 127.0.0.1:2222 user=$(id -un) key=$DIR/client_ed25519"
else
  echo "sshd did not start; see $DIR/sshd.log" >&2
  exit 1
fi
