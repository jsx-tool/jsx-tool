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

./scripts/build-linux-prebuilt.sh $BUILD_ARCH
npm run build
npm pack

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
  
  echo "Debugging: Checking node-pty build directory..."
  ls -lR node_modules/node-pty/build || echo "Build dir not found"
  
  echo "Debugging: Checking binary type..."
  apk add --no-cache file pax-utils
  ls -l node_modules/node-pty/build/Release/pty.node
  file node_modules/node-pty/build/Release/pty.node
  
  echo "Debugging: Checking shared libraries..."
  scanelf -n node_modules/node-pty/build/Release/pty.node
  
  echo "Debugging: Checking architecture..."
  uname -m
  
  echo "Debugging: Trying to require absolute path..."
  node <<EOF
    try {
      require('$(pwd)/node_modules/node-pty/build/Release/pty.node');
      console.log('✓ Require absolute path succeeded');
    } catch (e) {
      console.error('✗ Require absolute path failed:', e);
    }
EOF
  
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