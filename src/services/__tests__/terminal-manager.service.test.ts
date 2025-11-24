import 'reflect-metadata';
import { container } from 'tsyringe';
import { TerminalManagerService } from '../terminal-manager.service';
import * as pty from 'node-pty';
import { EventEmitter } from 'events';

import { ConfigService } from '../config.service';

jest.mock('node-pty', () => {
    return {
        spawn: jest.fn()
    };
});

describe('TerminalManagerService', () => {
    let terminalManager: TerminalManagerService;
    let mockPtyProcess: any;
    let mockConfigService: any;

    beforeEach(() => {
        container.clearInstances();

        mockPtyProcess = new EventEmitter();
        mockPtyProcess.write = jest.fn();
        mockPtyProcess.kill = jest.fn();
        mockPtyProcess.resize = jest.fn();
        mockPtyProcess.onData = jest.fn((cb) => mockPtyProcess.on('data', cb));
        mockPtyProcess.onExit = jest.fn((cb) => mockPtyProcess.on('exit', cb));

        (pty.spawn as jest.Mock).mockReturnValue(mockPtyProcess);

        mockConfigService = {
            getConfig: jest.fn().mockReturnValue({
                workingDirectory: '/test/cwd'
            })
        };
        container.registerInstance(ConfigService, mockConfigService);

        terminalManager = container.resolve(TerminalManagerService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('createSession', () => {
        it('should create a new terminal session', () => {
            const sessionId = terminalManager.createSession('/bin/zsh', [], 80, 24);

            expect(sessionId).toBeDefined();
            expect(typeof sessionId).toBe('string');
            expect(pty.spawn).toHaveBeenCalledWith('/bin/zsh', [], expect.objectContaining({
                cols: 80,
                rows: 24,
                cwd: '/test/cwd'
            }));
            expect(terminalManager.exists(sessionId)).toBe(true);
        });

        it('should emit created event', (done) => {
            terminalManager.on('created', (id) => {
                expect(id).toBeDefined();
                expect(typeof id).toBe('string');
                done();
            });
            terminalManager.createSession('/bin/zsh', [], 80, 24);
        });

        it('should emit data events when pty produces output', (done) => {
            const sessionId = terminalManager.createSession('/bin/zsh', [], 80, 24);

            terminalManager.on('data', (id) => {
                expect(id).toBe(sessionId);
                done();
            });

            mockPtyProcess.emit('data', 'test output');
        });

        it('should emit exit events when pty exits', (done) => {
            const sessionId = terminalManager.createSession('/bin/zsh', [], 80, 24);

            terminalManager.on('exit', (id, code, signal) => {
                expect(id).toBe(sessionId);
                expect(code).toBe(0);
                expect(signal).toBe(undefined);
                done();
            });

            mockPtyProcess.emit('exit', { exitCode: 0, signal: undefined });
        });
    });

    describe('write', () => {
        it('should write data to the pty process', () => {
            const sessionId = terminalManager.createSession('/bin/zsh', [], 80, 24);
            terminalManager.write(sessionId, 'ls\n');

            expect(mockPtyProcess.write).toHaveBeenCalledWith('ls\n');
        });

        it('should do nothing if session does not exist', () => {
            terminalManager.write('non-existent-session', 'ls\n');
            expect(mockPtyProcess.write).not.toHaveBeenCalled();
        });
    });

    describe('kill', () => {
        it('should kill the pty process and remove session', () => {
            const sessionId = terminalManager.createSession('/bin/zsh', [], 80, 24);
            terminalManager.kill(sessionId);

            expect(mockPtyProcess.kill).toHaveBeenCalled();
            expect(terminalManager.exists(sessionId)).toBe(false);
        });

        it('should do nothing if session does not exist', () => {
            terminalManager.kill('non-existent-session');
            expect(mockPtyProcess.kill).not.toHaveBeenCalled();
        });
    });

    describe('getLogs', () => {
        it('should return logs after the specified cursor', () => {
            const sessionId = terminalManager.createSession('/bin/zsh', [], 80, 24);

            mockPtyProcess.emit('data', 'line 1\n');
            mockPtyProcess.emit('data', 'line 2\n');

            const { logs, nextCursor } = terminalManager.getLogs(sessionId, 0);

            expect(logs).toHaveLength(2);
            expect(logs[0].data).toBe('line 1\n');
            expect(logs[1].data).toBe('line 2\n');
            expect(nextCursor).toBe(2);
        });

        it('should return empty logs if no new data', () => {
            const sessionId = terminalManager.createSession('/bin/zsh', [], 80, 24);

            mockPtyProcess.emit('data', 'line 1\n');

            const result1 = terminalManager.getLogs(sessionId, 0);
            expect(result1.logs).toHaveLength(1);

            const result2 = terminalManager.getLogs(sessionId, result1.nextCursor);
            expect(result2.logs).toHaveLength(0);
            expect(result2.nextCursor).toBe(result1.nextCursor);
        });

        it('should return empty logs for non-existent session', () => {
            const { logs, nextCursor } = terminalManager.getLogs('non-existent', 0);
            expect(logs).toEqual([]);
            expect(nextCursor).toBe(0);
        });
    });

    describe('getSessions', () => {
        it('should return all active session IDs', () => {
            const session1 = terminalManager.createSession('/bin/zsh', [], 80, 24);
            const session2 = terminalManager.createSession('/bin/zsh', [], 80, 24);

            const sessions = terminalManager.getSessions();
            expect(sessions).toContain(session1);
            expect(sessions).toContain(session2);
            expect(sessions.length).toBeGreaterThanOrEqual(2);

            terminalManager.kill(session1);
            expect(terminalManager.getSessions()).not.toContain(session1);
            expect(terminalManager.getSessions()).toContain(session2);
        });
    });
    describe('runOneOffCommand', () => {
        it('should run a command and return output', async () => {
            const promise = terminalManager.runOneOffCommand('echo "hello"');

            mockPtyProcess.emit('data', 'hello');
            mockPtyProcess.emit('exit', { exitCode: 0 });

            const output = await promise;
            expect(output).toBe('hello');
            expect(pty.spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
                cwd: '/test/cwd'
            }));
        });
    });
});
