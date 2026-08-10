export const storage = {
  get: (key) => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  set: (key, value)=> {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  remove: (key) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
};
