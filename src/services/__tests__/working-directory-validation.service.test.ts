jest.mock('fs');

import 'reflect-metadata';
import { WorkingDirectoryValidationService } from '../working-directory-validation.service';
import * as fs from 'fs';
import { join, resolve } from 'path';

const svc = new WorkingDirectoryValidationService();
const exists  = fs.existsSync   as jest.Mock;
const read    = fs.readFileSync as jest.Mock;
const stat    = fs.statSync     as jest.Mock;

describe('WorkingDirectoryValidationService', () => {
  const WORK_DIR     = resolve(process.cwd(), 'project', 'root');
  const PKG_PATH     = join(WORK_DIR, 'package.json');
  const REACT_FOLDER = join(WORK_DIR, 'node_modules', 'react');

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('fails when directory does not exist', () => {
    exists.mockReturnValue(false);

    const res = svc.validateWorkingDirectory(WORK_DIR);

    expect(res.isValid).toBe(false);
    expect(res.errors).toContain(`Directory does not exist: ${WORK_DIR}`);
  });

  it('fails when path is not a directory', () => {
    exists.mockReturnValue(true);
    stat.mockReturnValue({ isDirectory: () => false });

    const res = svc.validateWorkingDirectory(WORK_DIR);

    expect(res.isValid).toBe(false);
    expect(res.errors).toContain(`Path is not a directory: ${WORK_DIR}`);
  });

  it('fails when package.json is missing', () => {
    exists.mockImplementation((p: string) => p === WORK_DIR);
    stat.mockReturnValue({ isDirectory: () => true });

    const res = svc.validateWorkingDirectory(WORK_DIR);

    expect(res.hasPackageJson).toBe(false);
    expect(res.errors).toContain(`No package.json found in: ${WORK_DIR}`);
  });

  it('fails when React is not listed in package.json', () => {
    exists.mockImplementation((p: string) => p === WORK_DIR || p === PKG_PATH);
    stat.mockReturnValue({ isDirectory: () => true });
    read.mockReturnValueOnce(JSON.stringify({ name: 'demo-app' }));

    const res = svc.validateWorkingDirectory(WORK_DIR);

    expect(res.hasPackageJson).toBe(true);
    expect(res.hasReact).toBe(false);
    expect(res.errors).toContain('React is not listed in package.json dependencies');
  });

  it('fails when React is declared but not installed', () => {
    exists.mockImplementation(
      (p: string) => p === WORK_DIR || p === PKG_PATH
    );
    stat.mockReturnValue({ isDirectory: () => true });
    read.mockReturnValueOnce(
      JSON.stringify({ dependencies: { react: '^18.2.0' } })
    );

    const res = svc.validateWorkingDirectory(WORK_DIR);

    expect(res.hasReact).toBe(true);
    expect(res.reactVersion).toBe('^18.2.0');
    expect(res.errors).toContain(
        'React is in package.json but not installed (run npm install)'
    );
  });

  it('passes for a fully valid directory', () => {
    exists.mockImplementation(
      (p: string) => [WORK_DIR, PKG_PATH, REACT_FOLDER].includes(p)
    );
    stat.mockReturnValue({ isDirectory: () => true });
    read.mockReturnValueOnce(
      JSON.stringify({ dependencies: { react: '^18.2.0' } })
    );

    const res = svc.validateWorkingDirectory(WORK_DIR);

    expect(res.isValid).toBe(true);
    expect(res.hasPackageJson).toBe(true);
    expect(res.hasReact).toBe(true);
    expect(res.reactVersion).toBe('^18.2.0');
    expect(res.errors).toHaveLength(0);
  });

  it('returns null when package.json is absent', () => {
    exists.mockReturnValue(false);
    expect(svc.getPackageInfo(WORK_DIR)).toBeNull();
  });

  it('parses package.json and returns key fields', () => {
    exists.mockReturnValue(true);
    read.mockReturnValueOnce(
      JSON.stringify({
        name: 'demo-app',
        version: '1.0.0',
        dependencies: { react: '^18.2.0' },
      })
    );

    const info = svc.getPackageInfo(WORK_DIR)!;
    expect(info).toEqual({ name: 'demo-app', version: '1.0.0', react: '^18.2.0' });
  });

  it('ensureDirectoryExists reflects real directory state', () => {
    exists.mockReturnValue(true);
    stat.mockReturnValue({ isDirectory: () => true });
    expect(svc.ensureDirectoryExists(WORK_DIR)).toBe(true);

    exists.mockReturnValue(false);
    expect(svc.ensureDirectoryExists(WORK_DIR)).toBe(false);
  });
});