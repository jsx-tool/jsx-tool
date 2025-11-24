#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

if (process.env.CI || process.env.NODE_ENV === 'production') {
    process.exit(0);
}

console.log('Running postinstall...');

function setupTerminal() {
    console.log('Setting up terminal support...');

    const platform = process.platform;
    const arch = process.arch;
    const nodeAbi = process.versions.modules;

    if (platform === 'win32') {
        console.log('Windows detected - using standard npm installation for node-pty');
        try {
            require('node-pty');
            console.log('✓ node-pty is already installed and working');
            return;
        } catch (e) {
            console.log('Installing node-pty (this may compile from source if you have build tools)...');
            try {
                execSync('npm install node-pty@1.0.0', {
                    stdio: 'inherit',
                    cwd: path.resolve(__dirname, '..')
                });
                console.log('✓ node-pty installed successfully');
                return;
            } catch (installError) {
                console.log('⚠️  Could not install node-pty on Windows');
                console.log('   Terminal features will be unavailable.');
                console.log('   To enable terminal support, install Windows build tools:');
                console.log('   npm install --global windows-build-tools');
                return;
            }
        }
    }

    try {
        require('node-pty');
        console.log('✓ node-pty is already working');
        return;
    } catch (e) {
        console.log('node-pty needs setup, continuing...');

        const isAlpine = fs.existsSync('/etc/alpine-release');
        const platformName = isAlpine ? 'linux-alpine' : platform;
        const prebuiltName = `node-v${nodeAbi}-${platformName}-${arch}`;
        const prebuiltPath = path.join(__dirname, '..', 'vendor', 'node-pty-prebuilts', prebuiltName);
        const nodePtyPath = path.join(__dirname, '..', '..', 'node-pty');

        console.log(`Looking for prebuilt at: ${prebuiltPath}`);

        if (fs.existsSync(prebuiltPath)) {
            console.log(`✓ Found prebuilt for ${platformName}-${arch}`);

            const buildDir = path.join(nodePtyPath, 'build');
            if (!fs.existsSync(buildDir)) {
                fs.mkdirSync(buildDir, { recursive: true });
            }

            copyRecursiveSync(path.join(prebuiltPath, 'build'), buildDir);

            console.log('✓ Prebuilt binary copied successfully');

            try {
                require('node-pty');
                console.log('✓ node-pty is working!');
            } catch (testError) {
                console.log('⚠️  Prebuilt binary did not work, will try building from source');
                tryBuildFromSource();
            }
        } else {
            console.log(`⚠️  No prebuilt binary for ${platformName}-${arch} (Node ABI ${nodeAbi})`);
            tryBuildFromSource();
        }
    }
}

function tryBuildFromSource() {
    console.log('Attempting to build node-pty from source...');
    try {
        execSync('npm rebuild node-pty', {
            stdio: 'inherit',
            cwd: path.resolve(__dirname, '..')
        });

        try {
            require('node-pty');
            console.log('✓ Successfully built node-pty from source');
        } catch (e) {
            console.log('⚠️  Could not build node-pty from source');
            console.log('   Terminal features will be unavailable.');
        }
    } catch (buildError) {
        console.log('⚠️  Build failed. Terminal features will be unavailable.');
        console.log('   To enable terminal support, install build tools:');
        console.log('   - macOS: Install Xcode Command Line Tools');
        console.log('   - Linux: sudo apt-get install build-essential python3');
    }
}

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();

    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach(childItemName => {
            copyRecursiveSync(
                path.join(src, childItemName),
                path.join(dest, childItemName)
            );
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

function testNodePty() {
    console.log('Testing node-pty...');
    try {
        const pty = require('node-pty');
        const shell = process.platform === 'win32' ? 'cmd.exe' : 'sh';
        const ptyProcess = pty.spawn(shell, [], {});
        console.log('✓ node-pty test successful! PID:', ptyProcess.pid);
        ptyProcess.kill();
    } catch (e) {
        console.error('✗ node-pty test failed:', e.message);
    }
}

setupTerminal();

testNodePty();