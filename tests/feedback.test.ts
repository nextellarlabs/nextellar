import { displaySuccess, startProgress } from '../src/lib/feedback.js';

describe('feedback', () => {
  let output: string[] = [];
  let originalWrite: any;
  let originalLog: any;

  beforeEach(() => {
    output = [];
    originalWrite = process.stdout.write;
    originalLog = console.log;
    
    process.stdout.write = jest.fn((data: string) => {
      output.push(data);
      return true;
    }) as any;
    console.log = jest.fn((data: string) => output.push(data + '\n'));
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    console.log = originalLog;
    delete process.env.CI;
  });

  describe('displaySuccess', () => {
    it('works in interactive mode', async () => {
      const original = process.stdout.isTTY;
      (process.stdout as any).isTTY = true;
      delete process.env.CI;

      await displaySuccess('test-app');
      (process.stdout as any).isTTY = original;

      const text = output.join('');
      expect(text).toContain('✅ Nextellar scaffold complete!');
      expect(text).toContain('cd test-app');
      expect(text).toContain('npm run dev');
      expect(text).toContain('Finalizing setup');
    });

    it('works in CI environment', async () => {
      process.env.CI = 'true';

      await displaySuccess('test-app');

      const text = output.join('');
      expect(text).toContain('✅ Nextellar scaffold complete!');
      expect(text).toContain('cd test-app');
      expect(text).toContain('npm run dev');
    });

    it('works in non-TTY environment', async () => {
      const original = process.stdout.isTTY;
      (process.stdout as any).isTTY = false;

      await displaySuccess('test-app');
      (process.stdout as any).isTTY = original;

      const text = output.join('');
      expect(text).toContain('✅ Nextellar scaffold complete!');
      expect(text).toContain('cd test-app');
      expect(text).toContain('npm run dev');
    });
  });

  describe('startProgress', () => {
    it('returns null when not interactive', () => {
      const original = process.stdout.isTTY;
      (process.stdout as any).isTTY = false;
      
      const result = startProgress();
      (process.stdout as any).isTTY = original;
      
      expect(result).toBeNull();
    });

    it('returns null in CI', () => {
      process.env.CI = 'true';
      expect(startProgress()).toBeNull();
    });

    it('returns function when interactive', () => {
      const original = process.stdout.isTTY;
      (process.stdout as any).isTTY = true;
      delete process.env.CI;
      
      const stop = startProgress();
      (process.stdout as any).isTTY = original;
      
      expect(typeof stop).toBe('function');
      if (stop) stop();
    });

    it('shows progress frames', (done) => {
      const original = process.stdout.isTTY;
      (process.stdout as any).isTTY = true;
      delete process.env.CI;
      
      const stop = startProgress();
      
      setTimeout(() => {
        if (stop) stop();
        (process.stdout as any).isTTY = original;
        
        const text = output.join('');
        expect(text).toContain('Installing dependencies');
        expect(text).toContain('[●');
        done();
      }, 200);
    });
  });
});