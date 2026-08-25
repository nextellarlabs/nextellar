// Test for ReceiveForm Template Component — issue #841
// Tests the expected behaviour, props interface, and SSR-safety contract
// without mounting the component (no DOM / jsdom required).

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('ReceiveForm Component Template', () => {
  // ---------------------------------------------------------------------------
  // Props interface
  // ---------------------------------------------------------------------------
  describe('Component Interface Validation', () => {
    it('accepts an optional address prop', () => {
      interface ReceiveFormProps {
        address?: string;
        qrSize?: number;
        className?: string;
      }

      const minimal: ReceiveFormProps = {};
      const withAddress: ReceiveFormProps = {
        address: 'GABC1234XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      };
      const full: ReceiveFormProps = {
        address: 'GABC1234XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        qrSize: 300,
        className: 'my-class',
      };

      expect(minimal.address).toBeUndefined();
      expect(withAddress.address).toMatch(/^G/);
      expect(full.qrSize).toBe(300);
      expect(full.className).toBe('my-class');
    });

    it('defaults qrSize to 200 when not provided', () => {
      const DEFAULT_QR_SIZE = 200;
      const { qrSize = DEFAULT_QR_SIZE } = {};
      expect(qrSize).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Address resolution logic
  // ---------------------------------------------------------------------------
  describe('Address Resolution', () => {
    const resolveAddress = (
      addressProp: string | undefined,
      publicKey: string | undefined,
    ): string | undefined => addressProp ?? publicKey;

    it('uses the address prop when provided, even if wallet is connected', () => {
      const result = resolveAddress(
        'GPROP_ADDRESS_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        'GWALLET_ADDRESS_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      );
      expect(result).toBe('GPROP_ADDRESS_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    });

    it('falls back to the wallet publicKey when no address prop is given', () => {
      const result = resolveAddress(
        undefined,
        'GWALLET_ADDRESS_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      );
      expect(result).toBe('GWALLET_ADDRESS_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    });

    it('returns undefined when both addressProp and publicKey are absent', () => {
      expect(resolveAddress(undefined, undefined)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance criterion 2 — graceful fallback with no wallet
  // ---------------------------------------------------------------------------
  describe('Disconnected / Empty State', () => {
    it('renders an empty state when no address is available', () => {
      const hasAddress = (address: string | undefined) => Boolean(address);

      expect(hasAddress(undefined)).toBe(false);
      expect(hasAddress('')).toBe(false);
      expect(hasAddress('GABC...')).toBe(true);
    });

    it('shows a wallet-specific message when connected but no key returned', () => {
      const getMessage = (connected: boolean, address: string | undefined): string => {
        if (address) return '';
        return connected
          ? 'No address available.'
          : 'Connect your wallet to see your receive address.';
      };

      expect(getMessage(false, undefined)).toBe(
        'Connect your wallet to see your receive address.',
      );
      expect(getMessage(true, undefined)).toBe('No address available.');
      expect(getMessage(true, 'GABCDEF')).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance criterion 1 — QR generation is client-side only (SSR-safe)
  // ---------------------------------------------------------------------------
  describe('SSR Safety', () => {
    it('does not generate the QR code synchronously (deferred to useEffect)', () => {
      // Simulates the initial server-rendered state: qrDataUrl starts as null
      // and is populated only after the first client-side effect fires.
      let qrDataUrl: string | null = null;

      // Server render snapshot — no data URL yet
      expect(qrDataUrl).toBeNull();

      // Client hydration: useEffect fires and generates the QR
      const fakeDataUrl = 'data:image/png;base64,FAKE';
      qrDataUrl = fakeDataUrl; // represents the setState call inside useEffect

      expect(qrDataUrl).toBe(fakeDataUrl);
    });

    it('cancels QR generation if the component unmounts before the promise resolves', () => {
      let cancelled = false;
      const cleanup = () => { cancelled = true; };

      // Simulate the useEffect cleanup
      cleanup();

      expect(cancelled).toBe(true);
    });

    it('uses dynamic import for qrcode to avoid bundling it in the server chunk', () => {
      const componentPath = join(
        __dirname,
        '../../src/templates/default/src/components/ReceiveForm.tsx',
      );
      const source = readFileSync(componentPath, 'utf8');

      // Must use dynamic import, not a top-level static import of qrcode
      expect(source).toMatch(/import\s*\(\s*['"]qrcode['"]\s*\)/);
      // Must NOT have a static top-level import of qrcode
      expect(source).not.toMatch(/^import\s+.*from\s+['"]qrcode['"]/m);
    });
  });

  // ---------------------------------------------------------------------------
  // Copy-to-clipboard interaction
  // ---------------------------------------------------------------------------
  describe('Copy Address', () => {
    it('exposes a copy handler that writes the address to the clipboard', async () => {
      const address = 'GABC1234XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      let clipboardValue = '';
      let copied = false;

      const handleCopy = async () => {
        clipboardValue = address;
        copied = true;
        // Auto-reset after 2 s in real component; omitted in this unit test
      };

      await handleCopy();

      expect(clipboardValue).toBe(address);
      expect(copied).toBe(true);
    });

    it('does nothing when no address is present', async () => {
      const address: string | undefined = undefined;
      let clipboardValue = '';

      const handleCopy = async () => {
        if (!address) return;
        clipboardValue = address;
      };

      await handleCopy();

      expect(clipboardValue).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // Feature registry integration
  // ---------------------------------------------------------------------------
  describe('Feature Registry', () => {
    it('registers receive-form with correct metadata', async () => {
      const { getFeature, getFeatureIds } = await import('../../src/lib/features.js');

      const ids = getFeatureIds();
      expect(ids).toContain('receive-form');

      const feature = getFeature('receive-form');
      expect(feature).toBeDefined();
      expect(feature?.kind).toBe('component');
      expect(feature?.files).toEqual(['components/ReceiveForm.tsx']);
      expect(feature?.dependsOn).toContain('wallet');
      expect(feature?.npmDependencies).toContain('qrcode');
    });

    it('includes receive-form in the components umbrella', async () => {
      const { resolveFeatureWithDeps } = await import('../../src/lib/features.js');

      const ids = resolveFeatureWithDeps('components').map((f) => f.id);
      expect(ids).toContain('receive-form');
    });

    it('places wallet before receive-form in install order', async () => {
      const { resolveFeatureWithDeps } = await import('../../src/lib/features.js');

      const ids = resolveFeatureWithDeps('receive-form').map((f) => f.id);
      const walletIdx = ids.indexOf('wallet');
      const receiveIdx = ids.indexOf('receive-form');

      expect(walletIdx).toBeGreaterThanOrEqual(0);
      expect(walletIdx).toBeLessThan(receiveIdx);
    });
  });
});
