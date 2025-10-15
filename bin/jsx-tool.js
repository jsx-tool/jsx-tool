#!/usr/bin/env node
const path = require('path');
const distPath = path.join(__dirname, '..', 'dist', 'index.js');

try {
  const { main } = require(distPath);
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} catch (error) {
  console.error('Error: Could not find compiled files. Run "npm run build" first.');
  console.error(error);
  process.exit(1);
}