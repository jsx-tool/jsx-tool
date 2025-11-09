import { injectable, singleton, inject } from 'tsyringe';
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { generateKeyPairSync } from 'crypto';
import { Logger } from './logger.service';
import { ConfigService } from './config.service';

export interface KeyPairPaths {
  privateKeyPath: string
  publicKeyPath: string
}

@singleton()
@injectable()
export class LocalKeyService {
  private privateKey?: string;
  private publicKey?: string;
  private keyDir?: string;

  constructor (
    @inject(Logger) private readonly logger: Logger,
    @inject(ConfigService) private readonly config: ConfigService
  ) { }

  private getKeyDir (): string {
    if (this.keyDir) return this.keyDir;

    const workingDir = this.config.getConfig().workingDirectory;
    if (!workingDir) {
      throw new Error('Working directory not set. Cannot determine key location.');
    }

    const keyDir = join(workingDir, '.jsxtool', 'host-keys');
    this.keyDir = keyDir;

    if (!existsSync(keyDir)) {
      mkdirSync(keyDir, { recursive: true });
      this.logger.debug(`Created keys directory: ${keyDir}`);

      const gitignorePath = join(workingDir, '.jsxtool', '.gitignore');
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, '# Ignore all host authentication keys\nhost-keys\n', 'utf8');
        this.logger.debug('Created .gitignore in .jsxtool directory');
      }
    }

    return keyDir;
  }

  private getKeyPath (filename: string): string {
    const keyDir = this.getKeyDir();
    const keyPath = join(keyDir, filename);
    this.logger.debug(`Key path resolved to: ${keyPath}`);
    return keyPath;
  }

  getPrivateKey (): string | null {
    if (this.privateKey) return this.privateKey;

    const keyPath = this.getKeyPath('private-key.pem');
    if (!existsSync(keyPath)) {
      this.logger.warn(`Private key not found at: ${keyPath}`);
      return null;
    }

    try {
      this.privateKey = readFileSync(keyPath, 'utf8');
      return this.privateKey;
    } catch (err) {
      this.logger.error(`Failed to read private key: ${(err as Error).message}`);
      return null;
    }
  }

  getPublicKey (): string | null {
    if (this.publicKey) return this.publicKey;

    const keyPath = this.getKeyPath('public-key.pem');
    if (!existsSync(keyPath)) {
      this.logger.warn(`Public key not found at: ${keyPath}`);
      return null;
    }

    try {
      this.publicKey = readFileSync(keyPath, 'utf8');
      return this.publicKey;
    } catch (err) {
      this.logger.error(`Failed to read public key: ${(err as Error).message}`);
      return null;
    }
  }

  getKeyPaths (): KeyPairPaths {
    return {
      privateKeyPath: this.getKeyPath('private-key.pem'),
      publicKeyPath: this.getKeyPath('public-key.pem')
    };
  }

  hasKeys (): boolean {
    try {
      const { privateKeyPath, publicKeyPath } = this.getKeyPaths();
      return existsSync(privateKeyPath) && existsSync(publicKeyPath);
    } catch (err) {
      // If working directory isn't set, we can't check for keys
      return false;
    }
  }

  regenerateKeyPair (force: boolean = false): boolean {
    const { privateKeyPath, publicKeyPath } = this.getKeyPaths();

    try {
      const keysExist = this.hasKeys();

      if (keysExist && !force) {
        this.logger.warn('Key pair already exists. Use force=true to overwrite.');
        return false;
      }

      if (keysExist) {
        this.logger.info('Removing existing key pair...');
        try {
          if (existsSync(privateKeyPath)) unlinkSync(privateKeyPath);
          if (existsSync(publicKeyPath)) unlinkSync(publicKeyPath);
        } catch (err) {
          this.logger.error(`Failed to remove existing keys: ${(err as Error).message}`);
          return false;
        }
      }

      this.logger.info('Generating new ECDSA P-256 key pair...');

      const { publicKey, privateKey } = generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });

      writeFileSync(privateKeyPath, privateKey, 'utf8');
      writeFileSync(publicKeyPath, publicKey, 'utf8');

      this.clearCache();

      this.logger.success('✓ Key pair generated successfully');
      this.logger.info(`  Private key: ${privateKeyPath}`);
      this.logger.info(`  Public key: ${publicKeyPath}`);

      return true;
    } catch (err) {
      this.logger.error(`Failed to regenerate key pair: ${(err as Error).message}`);
      return false;
    }
  }

  removeKeyPair (): boolean {
    const { privateKeyPath, publicKeyPath } = this.getKeyPaths();

    try {
      let removed = false;

      if (existsSync(privateKeyPath)) {
        unlinkSync(privateKeyPath);
        removed = true;
        this.logger.info(`Removed private key: ${privateKeyPath}`);
      }

      if (existsSync(publicKeyPath)) {
        unlinkSync(publicKeyPath);
        removed = true;
        this.logger.info(`Removed public key: ${publicKeyPath}`);
      }

      if (!removed) {
        this.logger.info('No key pair to remove');
      }

      this.clearCache();

      return true;
    } catch (err) {
      this.logger.error(`Failed to remove key pair: ${(err as Error).message}`);
      return false;
    }
  }

  clearCache (): void {
    this.privateKey = undefined;
    this.publicKey = undefined;
  }

  getPublicKeyDer (): string | null {
    const publicKeyPem = this.getPublicKey();
    if (!publicKeyPem) return null;

    try {
      const base64 = publicKeyPem
        .replace(/-----BEGIN PUBLIC KEY-----/, '')
        .replace(/-----END PUBLIC KEY-----/, '')
        .replace(/\s/g, '');

      return base64;
    } catch (err) {
      this.logger.error(`Failed to convert public key to DER: ${(err as Error).message}`);
      return null;
    }
  }
}
