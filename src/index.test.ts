import 'reflect-metadata';

describe('CLI entry point', () => {
  it('should load without errors', () => {
    expect(() => require('./index')).not.toThrow();
  });
});