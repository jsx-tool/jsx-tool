#!/bin/bash
set -e

echo "Building Linux prebuilt using Docker..."

# Build in a Linux container
docker run --rm -v $(pwd):/workspace --platform linux/amd64 node:20 bash -c "
  cd /workspace
  
  # Get Node ABI
  NODE_ABI=\$(node -p 'process.versions.modules')
  echo \"Building for Linux x64, Node ABI \$NODE_ABI\"
  
  # Create temp build directory
  rm -rf temp-linux-build
  mkdir temp-linux-build
  cd temp-linux-build
  
  # Build node-pty
  npm init -y
  npm install node-pty@1.0.0
  
  # Copy to vendor
  cd ..
  VENDOR_DIR=\"vendor/node-pty-prebuilts/node-v\$NODE_ABI-linux-x64\"
  mkdir -p \"\$VENDOR_DIR\"
  cp -r temp-linux-build/node_modules/node-pty/build \"\$VENDOR_DIR/\"
  
  # Clean up
  rm -rf temp-linux-build
  
  echo \"✓ Linux prebuilt saved to \$VENDOR_DIR\"
"

echo "Linux prebuilt created successfully!"