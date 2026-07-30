import { displaySuccess} from '../src/lib/feedback.js';

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

  const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*m/g, '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

  describe('displaySuccess', () => {
    it('works in interactive mode', async () => {
      const original = process.stdout.isTTY;
      (process.stdout as any).isTTY = true;
      delete process.env.CI;

      await displaySuccess('test-app');
      (process.stdout as any).isTTY = original;

      const text = stripAnsi(output.join(''));
      expect(text).toMatch(/Project scaffolded successfully!/);
      expect(text).toMatch(/cd test-app/);
      expect(text).toMatch(/npm run dev/);
    });

    it('works in CI environment', async () => {
      process.env.CI = 'true';

      await displaySuccess('test-app');

      const text = stripAnsi(output.join(''));
      expect(text).toMatch(/Nextellar scaffold complete!/);
      expect(text).toMatch(/cd test-app/);
      expect(text).toMatch(/npm run dev/);
    });

    it('works in non-TTY environment', async () => {
      const original = process.stdout.isTTY;
      (process.stdout as any).isTTY = false;

      await displaySuccess('test-app');
      (process.stdout as any).isTTY = original;

      const text = stripAnsi(output.join(''));
      expect(text).toMatch(/Nextellar scaffold complete!/);
      expect(text).toMatch(/cd test-app/);
      expect(text).toMatch(/npm run dev/);
    });
  });
});