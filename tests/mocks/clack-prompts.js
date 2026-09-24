import { jest } from "@jest/globals";

export const intro = jest.fn();
export const text = jest.fn();
export const isCancel = jest.fn(() => false);
export const select = jest.fn();
export const multiselect = jest.fn();
export const confirm = jest.fn();
export const outro = jest.fn();

export default {
  intro,
  text,
  isCancel,
  select,
  multiselect,
  confirm,
  outro,
};
