#!/bin/bash
set -e

echo "Testing JSX Tool installation..."

# Build the prebuilt for your current platform
echo "Step 1: Building prebuilt for your platform..."
node scripts/build-prebuilts-locally.js

# Build your project
echo -e "\nStep 2: Building the project..."
npm run build

# Create a package
echo -e "\nStep 3: Creating npm package..."
npm pack

# Find the created tarball
TARBALL=$(ls -t *.tgz | head -1)
TARBALL_PATH=$(pwd)/$TARBALL
echo "Created package: $TARBALL"

# Test installation in a clean environment
echo -e "\nStep 4: Testing installation in clean environment..."
TEMP_DIR=$(mktemp -d)
cd $TEMP_DIR

echo "Testing in: $TEMP_DIR"

# Initialize test project
npm init -y

# Install without running scripts (simulating user without Python)
echo -e "\nInstalling package (with --ignore-scripts to simulate no Python)..."
npm install $TARBALL_PATH --ignore-scripts

# node-pty might not be installed with --ignore-scripts, so install it separately
echo -e "\nInstalling node-pty separately..."
npm install node-pty@1.0.0 --ignore-scripts --no-save

# Manually run postinstall
echo -e "\nRunning postinstall script..."
cd node_modules/@jsx-tool/jsx-tool
node bin/postinstall.js
cd ../..

# Test that it works
echo -e "\nTesting node-pty functionality..."
node -e "
  try {
    const pty = require('node-pty');
    const proc = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : 'sh', [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30
    });
    console.log('✓ SUCCESS: node-pty works! Process PID:', proc.pid);
    proc.kill();
    process.exit(0);
  } catch (e) {
    console.error('✗ FAILED:', e.message);
    process.exit(1);
  }
"

if [ $? -eq 0 ]; then
  echo -e "\n✓ All tests passed! Your package works without Python."
  echo "Test directory: $TEMP_DIR"
  echo "You can manually inspect it or run: rm -rf $TEMP_DIR"
else
  echo -e "\n✗ Tests failed. Check the output above."
  exit 1
fi