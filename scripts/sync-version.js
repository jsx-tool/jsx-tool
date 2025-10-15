#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '../package.json');
const versionFilePath = path.join(__dirname, '../src/version.ts');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

const versionFileContent = `// This file is auto-generated. Do not edit manually.
// Updated by pre-commit hook from package.json version
export const VERSION = '${version}';
`;

fs.writeFileSync(versionFilePath, versionFileContent, 'utf-8');
console.log(`✓ Synced version to ${version}`);