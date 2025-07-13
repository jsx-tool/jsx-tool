import { execSync } from 'child_process';

describe('CLI E2E', () => {
  it('should load and show help without errors', () => {
    expect(() => {
      execSync('node dist/index.js --help', { stdio: 'pipe' });
    }).not.toThrow();
  });
});
