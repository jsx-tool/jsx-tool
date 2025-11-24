#!/bin/bash
set -e

# Default to current arch if not specified
ARCH=${1:-"x64"}

echo "Building Linux prebuilts for $ARCH..."

build_variant() {
  local VARIANT=$1
  local IMAGE=$2
  local SUFFIX=$3
  
  # Map Node arch to Docker arch
  local DOCKER_ARCH=$ARCH
  if [ "$ARCH" = "x64" ]; then
    DOCKER_ARCH="amd64"
  elif [ "$ARCH" = "arm64" ]; then
    DOCKER_ARCH="arm64"
  fi
  
  echo "Building $VARIANT ($SUFFIX) using $IMAGE..."
  
  docker run --rm -v $(pwd):/workspace --platform linux/$DOCKER_ARCH $IMAGE sh -c "
    cd /workspace
    
    # Install build dependencies if needed (for Alpine)
    if [ -f /etc/alpine-release ]; then
      apk add --no-cache python3 make g++
    fi
    
    # Get Node ABI
    NODE_ABI=\$(node -p 'process.versions.modules')
    echo \"Building for Linux $ARCH ($VARIANT), Node ABI \$NODE_ABI\"
    
    # Create temp build directory
    BUILD_DIR=\"temp-linux-build-$VARIANT\"
    rm -rf \$BUILD_DIR
    mkdir \$BUILD_DIR
    cd \$BUILD_DIR
    
    # Build node-pty
    npm init -y
    npm install node-pty@1.0.0
    
    # Copy to vendor
    cd ..
    VENDOR_DIR=\"vendor/node-pty-prebuilts/node-v\$NODE_ABI-linux$SUFFIX-$ARCH\"
    mkdir -p \"\$VENDOR_DIR\"
    cp -r \$BUILD_DIR/node_modules/node-pty/build \"\$VENDOR_DIR/\"
    
    # Clean up
    rm -rf \$BUILD_DIR
    
    echo \"✓ Linux $VARIANT prebuilt saved to \$VENDOR_DIR\"
  "
}

# Build for standard Linux (glibc)
build_variant "glibc" "node:20" ""

# Build for Alpine Linux (musl)
build_variant "musl" "node:20-alpine" "-alpine"

echo "Linux prebuilts created successfully!"