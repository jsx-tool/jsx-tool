import 'reflect-metadata';
import { container } from 'tsyringe';
import { ConfigService } from '../config.service';
import { join } from 'path';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';

describe('ConfigService', () => {
  const testDir = join(__dirname, 'test-config-service');
  const jsxToolDir = join(testDir, '.jsxtool');
  const gitignorePath = join(jsxToolDir, '.gitignore');

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should create .gitignore with required entries if it does not exist', () => {
    const config = container.resolve(ConfigService);
    config.setWorkingDirectory(testDir);

    config.ensureGitIgnore();

    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('host-keys');
    expect(content).toContain('terminal-secret');
  });

  it('should append required entries to existing .gitignore', () => {
    mkdirSync(jsxToolDir, { recursive: true });
    writeFileSync(gitignorePath, 'existing-entry\n', 'utf8');

    const config = container.resolve(ConfigService);
    config.setWorkingDirectory(testDir);

    config.ensureGitIgnore();

    const content = readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('existing-entry');
    expect(content).toContain('host-keys');
    expect(content).toContain('terminal-secret');
  });

  it('should not duplicate entries if they already exist', () => {
    mkdirSync(jsxToolDir, { recursive: true });
    writeFileSync(gitignorePath, 'host-keys\nterminal-secret\n', 'utf8');

    const config = container.resolve(ConfigService);
    config.setWorkingDirectory(testDir);

    config.ensureGitIgnore();

    const content = readFileSync(gitignorePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim() !== '');
    expect(lines.filter(l => l === 'host-keys').length).toBe(1);
    expect(lines.filter(l => l === 'terminal-secret').length).toBe(1);
  });
});