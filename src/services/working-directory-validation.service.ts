import 'reflect-metadata';
import { injectable, singleton } from 'tsyringe';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

export interface WorkingDirectoryValidation {
  isValid: boolean
  hasPackageJson: boolean
  hasReact: boolean
  reactVersion?: string
  errors: string[]
}

@singleton()
@injectable()
export class WorkingDirectoryValidationService {
  validateWorkingDirectory (directory: string): WorkingDirectoryValidation {
    const result: WorkingDirectoryValidation = {
      isValid: false,
      hasPackageJson: false,
      hasReact: false,
      errors: []
    };

    const resolvedDir = resolve(directory);

    if (!existsSync(resolvedDir)) {
      result.errors.push(`Directory does not exist: ${resolvedDir}`);
      return result;
    }

    if (!statSync(resolvedDir).isDirectory()) {
      result.errors.push(`Path is not a directory: ${resolvedDir}`);
      return result;
    }

    const packageJsonPath = join(resolvedDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      result.errors.push(`No package.json found in: ${resolvedDir}`);
      return result;
    }

    result.hasPackageJson = true;

    try {
      const packageJsonContent = readFileSync(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonContent);

      const dependencies = packageJson.dependencies || {};
      const devDependencies = packageJson.devDependencies || {};

      const reactVersion = dependencies.react || devDependencies.react;

      if (!reactVersion) {
        result.errors.push('React is not listed in package.json dependencies');
        return result;
      }

      result.hasReact = true;
      result.reactVersion = reactVersion;

      const nodeModulesReactPath = join(resolvedDir, 'node_modules', 'react');
      if (!existsSync(nodeModulesReactPath)) {
        result.errors.push('React is in package.json but not installed (run npm install)');
        return result;
      }

      result.isValid = true;
    } catch (error) {
      result.errors.push(`Error reading/parsing package.json: ${(error as Error).message}`);
      return result;
    }

    return result;
  }

  getPackageInfo (directory: string): { name?: string, version?: string, react?: string } | null {
    try {
      const packageJsonPath = join(resolve(directory), 'package.json');
      if (!existsSync(packageJsonPath)) return null;

      const content = readFileSync(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(content);

      return {
        name: packageJson.name,
        version: packageJson.version,
        react: packageJson.dependencies?.react || packageJson.devDependencies?.react
      };
    } catch {
      return null;
    }
  }

  ensureDirectoryExists (directory: string): boolean {
    const resolvedDir = resolve(directory);
    return existsSync(resolvedDir) && statSync(resolvedDir).isDirectory();
  }
}
