export const storage = {
  get: (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  set: (key: string, value: string): void => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  remove: (key: string): void => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
};
