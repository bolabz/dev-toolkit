/**
 * Logger — Unit Tests
 *
 * Verifies level filtering, output format, child loggers,
 * env-var configuration, and stderr-only output.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Logger } from '../src/infra/logger.js';

describe('Logger', () => {
  let errorSpy: MockInstance;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Level filtering
  // -------------------------------------------------------------------------

  describe('level filtering', () => {
    it('default level is info', () => {
      const log = new Logger();
      expect(log.getLevel()).toBe('info');
    });

    it('suppresses messages below configured level', () => {
      const log = new Logger({ level: 'warn' });

      log.debug('should not appear');
      log.info('should not appear');
      expect(errorSpy).not.toHaveBeenCalled();

      log.warn('should appear');
      expect(errorSpy).toHaveBeenCalledTimes(1);

      log.error('should also appear');
      expect(errorSpy).toHaveBeenCalledTimes(2);
    });

    it('debug level shows all messages', () => {
      const log = new Logger({ level: 'debug' });

      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');
      expect(errorSpy).toHaveBeenCalledTimes(4);
    });

    it('error level suppresses debug, info, and warn', () => {
      const log = new Logger({ level: 'error' });

      log.debug('no');
      log.info('no');
      log.warn('no');
      expect(errorSpy).not.toHaveBeenCalled();

      log.error('yes');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('silent level suppresses all output', () => {
      const log = new Logger({ level: 'silent' });

      log.debug('no');
      log.info('no');
      log.warn('no');
      log.error('no');
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // setLevel / getLevel
  // -------------------------------------------------------------------------

  describe('setLevel', () => {
    it('changes filtering at runtime', () => {
      const log = new Logger({ level: 'info' });

      log.debug('suppressed');
      expect(errorSpy).not.toHaveBeenCalled();

      log.setLevel('debug');
      log.debug('now visible');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('getLevel reflects the current level', () => {
      const log = new Logger({ level: 'warn' });
      expect(log.getLevel()).toBe('warn');

      log.setLevel('error');
      expect(log.getLevel()).toBe('error');
    });
  });

  // -------------------------------------------------------------------------
  // Output format
  // -------------------------------------------------------------------------

  describe('output format', () => {
    it('includes timestamp, prefix, level label, and message', () => {
      const log = new Logger({ level: 'info' });
      log.info('test message');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const prefix = errorSpy.mock.calls[0][0] as string;
      const message = errorSpy.mock.calls[0][1] as string;

      // Prefix: "2026-04-08T18:30:00.000Z [gmail-toolkit] INFO  test message"
      expect(prefix).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/); // ISO timestamp
      expect(prefix).toContain('[gmail-toolkit]');
      expect(prefix).toContain('INFO');
      expect(message).toBe('test message');
    });

    it('passes extra args to console.error', () => {
      const log = new Logger({ level: 'info' });
      const obj = { key: 'value' };
      log.info('data:', obj);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const args = errorSpy.mock.calls[0];
      expect(args[1]).toBe('data:');
      expect(args[2]).toEqual({ key: 'value' });
    });

    it('uses correct level labels', () => {
      const log = new Logger({ level: 'debug' });

      log.debug('d');
      expect(errorSpy.mock.calls[0][0]).toContain('DEBUG');

      log.info('i');
      expect(errorSpy.mock.calls[1][0]).toContain('INFO');

      log.warn('w');
      expect(errorSpy.mock.calls[2][0]).toContain('WARN');

      log.error('e');
      expect(errorSpy.mock.calls[3][0]).toContain('ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // Child loggers
  // -------------------------------------------------------------------------

  describe('child loggers', () => {
    it('appends name to prefix', () => {
      const log = new Logger({ level: 'info' });
      const child = log.child('auth');

      child.info('hello');

      const prefix = errorSpy.mock.calls[0][0] as string;
      expect(prefix).toContain('[gmail-toolkit:auth]');
    });

    it('supports nested children', () => {
      const log = new Logger({ level: 'info' });
      const nested = log.child('client').child('messages');

      nested.info('nested');

      const prefix = errorSpy.mock.calls[0][0] as string;
      expect(prefix).toContain('[gmail-toolkit:client:messages]');
    });

    it('inherits root level dynamically', () => {
      const root = new Logger({ level: 'info' });
      const child = root.child('auth');

      child.debug('suppressed at info level');
      expect(errorSpy).not.toHaveBeenCalled();

      root.setLevel('debug');
      child.debug('now visible after root level change');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('setLevel on child affects root and siblings', () => {
      const root = new Logger({ level: 'info' });
      const childA = root.child('a');
      const childB = root.child('b');

      childA.setLevel('debug');

      // Root and sibling should reflect the change
      expect(root.getLevel()).toBe('debug');
      expect(childB.getLevel()).toBe('debug');
    });
  });

  // -------------------------------------------------------------------------
  // Env var
  // -------------------------------------------------------------------------

  describe('GMAIL_LOG_LEVEL env var', () => {
    const originalEnv = process.env.GMAIL_LOG_LEVEL;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.GMAIL_LOG_LEVEL;
      } else {
        process.env.GMAIL_LOG_LEVEL = originalEnv;
      }
    });

    it('respects GMAIL_LOG_LEVEL when set', () => {
      process.env.GMAIL_LOG_LEVEL = 'error';
      const log = new Logger(); // reads env in constructor

      expect(log.getLevel()).toBe('error');
    });

    it('ignores invalid GMAIL_LOG_LEVEL values', () => {
      process.env.GMAIL_LOG_LEVEL = 'verbose';
      const log = new Logger();

      expect(log.getLevel()).toBe('info'); // falls back to default
    });

    it('handles case-insensitive env var', () => {
      process.env.GMAIL_LOG_LEVEL = 'DEBUG';
      const log = new Logger();

      expect(log.getLevel()).toBe('debug');
    });
  });

  // -------------------------------------------------------------------------
  // stderr guarantee
  // -------------------------------------------------------------------------

  describe('stderr output', () => {
    it('all output goes through console.error', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = new Logger({ level: 'debug' });

      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(4);

      logSpy.mockRestore();
    });
  });
});
