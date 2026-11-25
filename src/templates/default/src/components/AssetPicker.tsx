'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from '../contexts/I18nProvider';
export type PickerAsset = { code: string; issuer?: string };
type Trustline = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
};

export interface AssetPickerProps {
  value: PickerAsset | null;
  onChange: (asset: PickerAsset) => void;
  /** Pass the connected account's balances, including trustlines. */
  balances?: readonly Trustline[];
  /** Optional additional assets already known by the application. */
  assets?: readonly PickerAsset[];
}

const nativeAsset: PickerAsset = { code: 'XLM' };

function assetKey(asset: PickerAsset) {
  return JSON.stringify([asset.code, asset.issuer ?? null]);
}

function collectAssets(balances: readonly Trustline[], assets: readonly PickerAsset[]) {
  const options = new Map([[assetKey(nativeAsset), nativeAsset]]);
  for (const balance of balances) {
    if (
      (balance.asset_type === 'credit_alphanum4' || balance.asset_type === 'credit_alphanum12') &&
      balance.asset_code &&
      balance.asset_issuer
    ) {
      const asset = { code: balance.asset_code, issuer: balance.asset_issuer };
      options.set(assetKey(asset), asset);
    }
  }
  for (const asset of assets) {
    if (asset.issuer) options.set(assetKey(asset), asset);
  }
  return Array.from(options.values());
}

/** A controlled selector for native XLM, wallet trustlines, and supplied assets. */
export function AssetPicker({ value, onChange, balances = [], assets = [] }: AssetPickerProps) {
  const { t } = useTranslation();
  const id = useId();
  const listId = `${id}-list`;
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const term = query.trim().toLowerCase();
  const options = collectAssets(balances, assets).filter(
    ({ code, issuer }) => code.toLowerCase().includes(term) || issuer?.toLowerCase().includes(term),
  );
  const activeIndex = options.findIndex((asset) => assetKey(asset) === activeKey);
  const selectedKey = value && assetKey(value);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      list.current?.children.item(activeIndex)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeIndex, open]);

  function close() {
    setOpen(false);
    setQuery('');
    setActiveKey(null);
  }

  function select(asset: PickerAsset) {
    onChange(asset);
    close();
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        setOpen(true);
        if (options.length === 0) return;
        const down = event.key === 'ArrowDown';
        const next = activeIndex < 0
          ? (down ? 0 : options.length - 1)
          : Math.max(0, Math.min(options.length - 1, activeIndex + (down ? 1 : -1)));
        setActiveKey(assetKey(options[next]));
        break;
      }
      case 'Enter':
        if (open && activeIndex >= 0) {
          event.preventDefault();
          select(options[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          close();
        }
        break;
    }
  }

  return (
    <div className="relative space-y-1 text-sm">
      <label className="block font-medium text-gray-900 dark:text-white" htmlFor={id}>
        {t('assetPicker.label')}
      </label>
      <input
        id={id}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-describedby={!open && value?.issuer ? `${id}-issuer` : undefined}
        autoComplete="off"
        value={open ? query : value?.code ?? ''}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={close}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveKey(null);
          setOpen(true);
        }}
        onKeyDown={handleKey}
      />
      {!open && value?.issuer && (
        <p id={`${id}-issuer`} className="break-all text-gray-600 dark:text-gray-300">
          {t('assetPicker.issuer', { issuer: value.issuer })}
        </p>
      )}
      <div
        hidden={!open}
        className="absolute inset-x-0 z-10 rounded-lg border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-900"
      >
        <ul
          ref={list}
          id={listId}
          className="max-h-56 overflow-y-auto"
          role="listbox"
          aria-label={t('assetPicker.list')}
        >
          {options.map((asset, index) => {
            const key = assetKey(asset);
            return (
              <li
                key={key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={key === selectedKey}
                className={`cursor-pointer px-3 py-2 text-gray-900 dark:text-white ${key === activeKey ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
                onMouseEnter={() => setActiveKey(key)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(asset)}
              >
                <span className="block font-medium">{asset.code}</span>
                <span className="block break-all text-xs text-gray-600 dark:text-gray-300">
                  {asset.issuer ? t('assetPicker.issuer', { issuer: asset.issuer }) : t('assetPicker.native')}
                </span>
              </li>
            );
          })}
        </ul>
        {options.length === 0 && (
          <p role="status" className="px-3 py-2 text-gray-600 dark:text-gray-300">
            {t('assetPicker.noResults')}
          </p>
        )}
      </div>
    </div>
  );
}
