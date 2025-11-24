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

# Test in Alpine container (no Python)
docker run --rm -v $TARBALL_PATH:/package.tgz node:20-alpine sh -c "
  echo 'Confirming no Python...'
  if which python || which python3; then
    echo 'ERROR: Python found, test invalid'
    exit 1
  fi
  
  echo '✓ No Python available'
  
  cd /tmp
  npm init -y
  
  echo 'Installing package...'
  npm install /package.tgz --ignore-scripts > /dev/null 2>&1
  
  echo 'Running postinstall...'
  cd node_modules/@jsx-tool/jsx-tool
  node bin/postinstall.js
  cd ../..
  
  echo 'Testing node-pty...'
  node -e \"
    const pty = require('node-pty');
    const proc = pty.spawn('sh', [], {});
    console.log('✓ node-pty works without Python! PID:', proc.pid);
    proc.kill();
  \"
"

echo "✓ Docker test passed!"