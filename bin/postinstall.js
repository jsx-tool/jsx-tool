#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const originalStderrWrite = process.stderr.write;
function suppressErrors() {
    process.stderr.write = () => { };
}
function restoreErrors() {
    process.stderr.write = originalStderrWrite;
}

async function runCommand(command, args, cwd) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            stdio: 'pipe',
            shell: process.platform === 'win32'
        });

        child.on('close', (code) => {
            resolve(code === 0);
        });

        child.on('error', () => {
            resolve(false);
        });
    });
}

async function checkNodePty() {
    suppressErrors();
    try {
        require('node-pty');
        restoreErrors();
        return true;
    } catch (e) {
        restoreErrors();
        return false;
    }
}

async function setupNodePty() {
    if (await checkNodePty()) {
        console.log('✓ node-pty is already working');
        return true;
    }

    console.log('Setting up terminal support...');

    let nodePtyPath;
    try {
        nodePtyPath = require.resolve('node-pty/package.json');
    } catch (e) {
        console.log('Installing node-pty...');
        const installSuccess = await runCommand('npm', ['install', 'node-pty', '--no-save', '--no-package-lock'], process.cwd());

        if (!installSuccess) {
            console.log('ℹ️  Terminal support is optional. Skipping installation.');
            return false;
        }

        try {
            nodePtyPath = require.resolve('node-pty/package.json');
        } catch (e) {
            console.log('ℹ️  Terminal support requires additional setup.');
            return false;
        }
    }

    const nodePtyDir = path.dirname(nodePtyPath);

    const rebuildSuccess = await runCommand('npm', ['rebuild', 'node-pty'], process.cwd());

    if (rebuildSuccess && await checkNodePty()) {
        console.log('✓ Terminal support enabled');
        return true;
    }

    const nodeAbi = process.versions.modules;
    const platform = process.platform;
    const arch = process.arch;
    const nodePtyPackage = require(nodePtyPath);
    const version = nodePtyPackage.version;

    const fileName = `node-v${nodeAbi}-${platform}-${arch}.tar.gz`;
    const downloadUrl = `https://github.com/microsoft/node-pty/releases/download/v${version}/${fileName}`;

    const hasCurl = await runCommand('which', ['curl'], process.cwd());
    const hasWget = await runCommand('which', ['wget'], process.cwd());

    if (hasCurl) {
        await runCommand(
            'sh',
            ['-c', `curl -sL "${downloadUrl}" 2>/dev/null | tar -xz -C "${nodePtyDir}" --strip-components=2 2>/dev/null`],
            process.cwd()
        );
    } else if (hasWget) {
        await runCommand(
            'sh',
            ['-c', `wget -qO- "${downloadUrl}" 2>/dev/null | tar -xz -C "${nodePtyDir}" --strip-components=2 2>/dev/null`],
            process.cwd()
        );
    }

    try {
        delete require.cache[require.resolve('node-pty')];
        delete require.cache[require.resolve('node-pty/lib/index.js')];
        delete require.cache[require.resolve('node-pty/lib/unixTerminal.js')];
    } catch (e) {
    }

    if (await checkNodePty()) {
        console.log('✓ Terminal support enabled');
        return true;
    }

    console.log('ℹ️  Terminal support requires additional setup.');
    console.log('   Run "npm rebuild node-pty" to enable terminal features.');

    return false;
}

if (require.main === module) {
    setupNodePty().then(() => {
        process.exit(0);
    }).catch(() => {
        process.exit(0);
    });
}