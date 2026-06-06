import { Operation } from 'stellar-sdk';

export interface MultisigValidation {
  valid: boolean;
  error?: string;
}

export const validateMultisigOperation = (data: any): MultisigValidation => {
  const { weight, lowThreshold, medThreshold, highThreshold } = data;

  if (weight !== undefined && (weight < 0 || weight > 255)) {
    return { valid: false, error: 'Weight must be between 0 and 255' };
  }

  if (lowThreshold !== undefined && lowThreshold < 0) {
    return { valid: false, error: 'Low threshold cannot be negative' };
  }

  if (medThreshold !== undefined && medThreshold < lowThreshold) {
    return { valid: false, error: 'Medium threshold cannot be less than low threshold' };
  }

  if (highThreshold !== undefined && highThreshold < medThreshold) {
    return { valid: false, error: 'High threshold cannot be less than medium threshold' };
  }

  return { valid: true };
};

export const buildAddSignerOperation = (publicKey: string, weight: number) => {
  return Operation.setOptions({
    signer: { ed25519PublicKey: publicKey, weight },
  });
};

export const buildRemoveSignerOperation = (publicKey: string) => {
  return Operation.setOptions({
    signer: { ed25519PublicKey: publicKey, weight: 0 },
  });
};

export const buildSetThresholdsOperation = (low: number, med: number, high: number) => {
  return Operation.setOptions({
    lowThreshold: low,
    medThreshold: med,
    highThreshold: high,
  });
};