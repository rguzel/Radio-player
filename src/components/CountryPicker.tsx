import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Globe, Search, X } from 'lucide-react';
import { RadioService } from '../services/radioService';
import {
  Country, countryName, FALLBACK_COUNTRIES, flagUrl, normalizeForSearch, PINNED_COUNTRY_CODES,
} from '../utils/countries';

// Loaded once per page and shared by every picker instance.
let countriesPromise: Promise<Country[]> | null = null;

function loadCountries(): Promise<Country[]> {
  countriesPromise ??= RadioService.getCountries()
    .then(list => {
      const byCode = new Map<string, Country>();
      for (const { name, iso_3166_1, stationcount } of list) {
        const code = iso_3166_1?.toUpperCase();
        if (!code || code.length !== 2 || stationcount <= 0) continue;
        const existing = byCode.get(code);
        if (existing) {
          existing.stations += stationcount;
          existing.aliases.push(name);
        } else {
          byCode.set(code, { code, name: countryName(code), aliases: [name], stations: stationcount });
        }
      }
      const countries = [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
      return countries.length ? countries : FALLBACK_COUNTRIES;
    })
    .catch(() => {
      countriesPromise = null; // try again next time the picker opens
      return FALLBACK_COUNTRIES;
    });
  return countriesPromise;
}

export function Flag({ code, className = '' }: { code: string; className?: string }) {
  const src = flagUrl(code);
  if (!src) return <Globe size={16} className={`text-slate-500 ${className}`} aria-hidden />;
  return <img src={src} alt="" width={20} height={15} loading="lazy" className={`w-5 h-[15px] rounded-[3px] object-cover shrink-0 ${className}`} />;
}

interface Option {
  code: string; // '' = all countries
  name: string;
  stations?: number;
  group?: string; // heading shown before this option
}

const numberFormat = new Intl.NumberFormat();

/**
 * Searchable country picker with flags. A dropdown on large screens and a
 * bottom sheet on small ones. Follows the ARIA combobox + listbox pattern:
 * type to filter, arrow keys to move, Enter to choose, Escape to close.
 */
export function CountryPicker({ value, onChange, compact = false }: {
  /** ISO 3166-1 alpha-2 code, or '' for all countries. */
  value: string;
  onChange: (code: string) => void;
  /** Smaller trigger for the mobile header. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [countries, setCountries] = useState<Country[]>(FALLBACK_COUNTRIES);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const options = useMemo<Option[]>(() => {
    const q = normalizeForSearch(query.trim());
    if (q) {
      return countries
        .filter(c => [c.name, c.code, ...c.aliases].some(text => normalizeForSearch(text).includes(q)))
        .map(c => ({ code: c.code, name: c.name, stations: c.stations }));
    }
    const pinned = PINNED_COUNTRY_CODES
      .map(code => countries.find(c => c.code === code) ?? { code, name: countryName(code), stations: 0, aliases: [] })
      .map((c, i) => ({ code: c.code, name: c.name, stations: c.stations, group: i === 0 ? 'Suggested' : undefined }));
    const rest = countries
      .filter(c => !PINNED_COUNTRY_CODES.includes(c.code))
      .map((c, i) => ({ code: c.code, name: c.name, stations: c.stations, group: i === 0 ? 'All countries' : undefined }));
    return [{ code: '', name: 'All countries' }, ...pinned, ...rest];
  }, [countries, query]);

  const openPicker = () => {
    setOpen(true);
    setQuery('');
    setLoading(true);
    loadCountries().then(list => {
      setCountries(list);
      setLoading(false);
    });
  };

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (code: string) => {
    close();
    if (code !== value) onChange(code);
  };

  // Start on the selected option; jump to the first match when filtering.
  // (Re-runs when the full list arrives, since that changes `options`.)
  useEffect(() => {
    if (!open) return;
    const selected = options.findIndex(o => o.code === value);
    setActiveIndex(query ? 0 : Math.max(0, selected));
  }, [open, query, options, value]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    // On touch screens don't pop the keyboard over the list straight away.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
    const isSheet = !window.matchMedia('(min-width: 1024px)').matches;
    const previousOverflow = document.body.style.overflow;
    if (isSheet) document.body.style.overflow = 'hidden';

    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option.code);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const label = value ? countryName(value) : 'All countries';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Country: ${label}`}
        className={`flex items-center gap-2 bg-white/5 border border-white/10 rounded-full text-slate-200 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 transition-colors ${
          compact ? 'h-10 pl-3 pr-2.5 text-sm max-w-[44vw]' : 'h-11 pl-4 pr-3 text-sm'
        }`}
      >
        {value ? <Flag code={value} /> : <Globe size={16} className="text-slate-400 shrink-0" aria-hidden />}
        <span className="truncate">{label}</span>
        <ChevronDown size={16} className={`text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <>
          {/* Backdrop for the mobile sheet */}
          <div className="fixed inset-0 z-[70] bg-black/60 lg:hidden" aria-hidden onClick={() => close(false)} />
          <div
            role="dialog"
            aria-label="Choose a country"
            onKeyDown={onKeyDown}
            className="fixed inset-x-0 bottom-0 z-[71] flex flex-col max-h-[80dvh] bg-[#0b0b0d] border-t border-white/10 rounded-t-3xl shadow-2xl pb-[env(safe-area-inset-bottom)]
              lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-full lg:mt-2 lg:w-80 lg:max-h-[440px] lg:rounded-2xl lg:border lg:pb-0"
          >
            <div className="lg:hidden flex items-center justify-between px-5 pt-3 pb-1">
              <span className="text-sm font-bold text-white">Choose a country</span>
              <button onClick={() => close()} aria-label="Close" className="p-2 -mr-2 rounded-full text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="p-3 border-b border-white/5">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
                  aria-autocomplete="list"
                  aria-label="Search countries"
                  placeholder="Search countries"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  // 16px on phones so iOS doesn't zoom into the field.
                  className="w-full h-11 lg:h-10 pl-9 pr-3 rounded-xl bg-white/5 border border-white/10 text-base lg:text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent/50"
                />
              </div>
            </div>
            <ul ref={listRef} id={listId} role="listbox" aria-label="Countries" className="flex-1 overflow-y-auto overscroll-contain thin-scroll py-1">
              {options.map((option, index) => {
                const selected = option.code === value;
                const active = index === activeIndex;
                return (
                  <li key={option.code || 'all'} role="presentation">
                    {option.group && (
                      <div role="presentation" className="px-4 pt-3 pb-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">
                        {option.group}
                      </div>
                    )}
                    <div
                      id={`${listId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={selected}
                      onClick={() => choose(option.code)}
                      onMouseMove={() => setActiveIndex(index)}
                      className={`flex items-center gap-3 mx-1 px-3 min-h-11 rounded-lg cursor-pointer text-sm ${
                        active ? 'bg-white/10 text-white' : 'text-slate-300'
                      }`}
                    >
                      {option.code ? <Flag code={option.code} /> : <Globe size={16} className="text-slate-400 w-5 shrink-0" aria-hidden />}
                      <span className="flex-1 truncate">{option.name}</span>
                      {option.stations ? (
                        <span className="text-[11px] tabular-nums text-slate-600">{numberFormat.format(option.stations)}</span>
                      ) : null}
                      {selected && <Check size={16} className="text-accent shrink-0" aria-hidden />}
                    </div>
                  </li>
                );
              })}
              {options.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-slate-500" role="presentation">
                  {loading ? 'Loading countries…' : `No country matches “${query}”.`}
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
