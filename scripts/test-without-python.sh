#!/bin/bash
set -e

echo "Testing installation without Python (using Docker)..."

# Build prebuilt and package first
node scripts/build-prebuilts-locally.js
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
  npm install /package.tgz --ignore-scripts
  
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