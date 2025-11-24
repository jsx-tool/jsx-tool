#!/bin/bash
set -e

echo "Testing installation without Python (using Docker)..."

# Build prebuilt and package first
node scripts/build-prebuilts-locally.js

# Build Linux prebuilts for current arch
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
  BUILD_ARCH="x64"
elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  BUILD_ARCH="arm64"
else
  BUILD_ARCH="x64"
fi

echo "PHASE 1: Generating prebuilts (Dev/CI only - requires Python)..."
./scripts/build-linux-prebuilt.sh $BUILD_ARCH > /dev/null 2>&1
echo "✓ Prebuilts generated"

echo "PHASE 2: Packaging..."
npm run build > /dev/null 2>&1
npm pack > /dev/null 2>&1

TARBALL=$(ls -t *.tgz | head -1)
TARBALL_PATH=$(pwd)/$TARBALL

echo "Inspecting tarball contents..."
tar -tf $TARBALL_PATH | grep "vendor/node-pty/" | head -n 10

echo "Testing installation without Python (using Docker)..."

# Create a test script to run inside Docker
cat > test-install.sh <<EOF
set -e

# Verify no Python
if command -v python3 >/dev/null 2>&1; then
  echo "Error: Python is present!"
  exit 1
fi
echo "Confirming no Python..."
echo "✓ No Python available"

mkdir /tmp/test-install
cd /tmp/test-install
npm init -y

echo 'Installing package...'
npm install /package.tgz

echo 'Testing node-pty...'
node -e "
  const pty = require('node-pty');
  const proc = pty.spawn('sh', [], {});
  console.log('✓ node-pty works without Python! PID:', proc.pid);
  proc.kill();
"
EOF

# Test in Alpine container (no Python)
docker run --rm \
  -v "$TARBALL_PATH:/package.tgz" \
  -v "$(pwd)/test-install.sh:/test-install.sh" \
  node:20-alpine sh /test-install.sh

echo "✓ Docker test passed!"