import { setVerbose, isVerbose, logVerboseError } from '../src/lib/verbose.js';

describe('verbose', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    setVerbose(false);
  });

  it('defaults to disabled', () => {
    expect(isVerbose()).toBe(false);
  });

  it('reflects setVerbose(true)', () => {
    setVerbose(true);
    expect(isVerbose()).toBe(true);
  });

  it('reflects setVerbose(false) after being enabled', () => {
    setVerbose(true);
    setVerbose(false);
    expect(isVerbose()).toBe(false);
  });

  it('logVerboseError prints nothing when verbose is disabled', () => {
    setVerbose(false);
    logVerboseError(new Error('boom'));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logVerboseError prints the error stack when verbose is enabled', () => {
    setVerbose(true);
    logVerboseError(new Error('boom'));
    expect(errorSpy).toHaveBeenCalled();
    const output = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('boom');
  });

  it('logVerboseError prints stdout/stderr/exitCode from an execa-style error', () => {
    setVerbose(true);
    logVerboseError({
      message: 'Command failed',
      exitCode: 1,
      stdout: 'partial output',
      stderr: 'permission denied',
    });
    const output = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('exit code: 1');
    expect(output).toContain('partial output');
    expect(output).toContain('permission denied');
  });

  it('logVerboseError handles a non-Error, non-object value', () => {
    setVerbose(true);
    expect(() => logVerboseError('just a string')).not.toThrow();
    const output = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('just a string');
  });
});
