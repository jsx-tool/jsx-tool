#!/usr/bin/env node

const path = require('path');
const distPath = path.join(__dirname, '..', 'dist', 'index.js');

try {
  require(distPath);
} catch (error) {
  console.error('Error: Could not find compiled files. Run "npm run build" first.');
  process.exit(1);
}