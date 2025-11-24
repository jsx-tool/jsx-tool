#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function setupNodePty() {
    console.log('Setting up terminal support...');

    let nodePtyDir;

    nodePtyDir = path.join(__dirname, '..', '..', 'node-pty');

    if (!fs.existsSync(nodePtyDir)) {
        try {
            const nodePtyPath = require.resolve('node-pty/package.json');
            nodePtyDir = path.dirname(nodePtyPath);
        } catch (e) {
            console.log('⚠️  node-pty is not installed. Terminal features will be unavailable.');
            return;
        }
    }

    try {
        delete require.cache[require.resolve('node-pty')];
        require('node-pty');
        console.log('✓ Terminal support is already enabled');
        return;
    } catch (e) {
        console.log('node-pty needs setup, continuing...');
    }

    const platform = process.platform;
    const arch = process.arch;
    const nodeAbi = process.versions.modules;

    const prebuiltName = `node-v${nodeAbi}-${platform}-${arch}`;
    const vendorDir = path.join(__dirname, '..', 'vendor', 'node-pty-prebuilts', prebuiltName);
    const prebuiltBinary = path.join(vendorDir, 'build', 'Release', 'pty.node');

    console.log('Looking for prebuilt at:', prebuiltBinary);

    if (!fs.existsSync(prebuiltBinary)) {
        console.log(`⚠️  No prebuilt binary for ${platform}-${arch} (Node ABI ${nodeAbi})`);
        console.log('   Terminal features will be unavailable.');
        return;
    }

    const targetDir = path.join(nodePtyDir, 'build', 'Release');
    const targetBinary = path.join(targetDir, 'pty.node');

    console.log('Copying prebuilt to:', targetBinary);

    try {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(prebuiltBinary, targetBinary);

        if (platform === 'darwin') {
            const spawnHelper = path.join(vendorDir, 'build', 'Release', 'spawn-helper');
            if (fs.existsSync(spawnHelper)) {
                const targetHelper = path.join(targetDir, 'spawn-helper');
                fs.copyFileSync(spawnHelper, targetHelper);
                fs.chmodSync(targetHelper, 0o755);
                console.log('Also copied spawn-helper for macOS');
            }
        }

        delete require.cache[require.resolve('node-pty')];
        require('node-pty');
        console.log('✓ Terminal support enabled');
    } catch (e) {
        console.error('⚠️  Could not enable terminal support:', e.message);
    }
}

if (require.main === module) {
    setupNodePty();
    process.exit(0);
}