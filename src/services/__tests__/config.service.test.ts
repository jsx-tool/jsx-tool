import 'reflect-metadata';
import { ConfigService } from '../config.service';
import { DEFAULT_CONFIG } from '../../types/config';
import * as fs from 'fs';

jest.mock('fs');

describe('ConfigService', () => {
    let configService: ConfigService;
  const mockFs = fs as jest.Mocked<typeof fs>;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    configService = new ConfigService();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('loadFromFile', () => {
    it('should load config from file', async () => {
      const mockConfig = {
        serverPort: 4000,
        proxyPort: 5000,
        wsPort: 6000
      };
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
      
      await configService.loadFromFile('/test/dir');
      
      const config = configService.getConfig();
      expect(config.serverPort).toBe(4000);
      expect(config.proxyPort).toBe(5000);
      expect(config.wsPort).toBe(6000);
    });

    it('should handle missing config file gracefully', async () => {
      mockFs.existsSync.mockReturnValue(false);
      
      await configService.loadFromFile('/test/dir');
      
      const config = configService.getConfig();
      expect(config.serverPort).toBe(DEFAULT_CONFIG.serverPort);
      
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');
      
      await configService.loadFromFile('/test/dir');
      
      const config = configService.getConfig();
      expect(config.serverPort).toBe(DEFAULT_CONFIG.serverPort);
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error loading config from'),
        expect.any(Error)
      );
    });
  });

  describe('validate', () => {
    it('should validate valid configuration', () => {
      const result = configService.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate invalid ports', () => {
      configService.setFromCliOptions({ serverPort: 0 });
      
      const result = configService.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Server port must be between 1 and 65535');
    });

    it('should validate invalid protocols', () => {
      configService.setFromCliOptions({ serverProtocol: 'ftp' as any });
      
      const result = configService.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Server protocol must be http or https');
    });
  });

  describe('CLI options', () => {
    it('should override file config with CLI options', () => {
      configService.setFromCliOptions({
        serverPort: 7000,
        proxyHost: '0.0.0.0'
      });
      
      const config = configService.getConfig();
      expect(config.serverPort).toBe(7000);
      expect(config.proxyHost).toBe('0.0.0.0');
    });
  });
});