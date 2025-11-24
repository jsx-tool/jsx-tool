#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const nodeAbi = process.versions.modules;
const platform = process.platform;
const arch = process.arch;

console.log(`Building node-pty for ${platform}-${arch} (Node ABI ${nodeAbi})...`);

const tempDir = path.join(__dirname, '..', 'temp-build');
if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
}
fs.mkdirSync(tempDir);

try {
    process.chdir(tempDir);
    execSync('npm init -y', { stdio: 'inherit' });
    execSync('npm install node-pty@1.0.0', { stdio: 'inherit' });

    const prebuiltName = `node-v${nodeAbi}-${platform}-${arch}`;
    const vendorDir = path.join(__dirname, '..', 'vendor', 'node-pty-prebuilts', prebuiltName);

    fs.mkdirSync(vendorDir, { recursive: true });

    const sourceDir = path.join(tempDir, 'node_modules', 'node-pty', 'build');
    const targetDir = path.join(vendorDir, 'build');

    fs.cpSync(sourceDir, targetDir, { recursive: true });

    console.log(`✓ Built and saved to vendor/node-pty-prebuilts/${prebuiltName}`);

    process.chdir(__dirname);
    fs.rmSync(tempDir, { recursive: true });

} catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
}

console.log('\n✓ Prebuilt created successfully!');
console.log('Now you can test the package installation.');