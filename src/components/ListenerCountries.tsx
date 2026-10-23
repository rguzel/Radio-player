import { motion } from 'motion/react';
import { Globe } from 'lucide-react';
import { CountryPlays } from '../services/playStatsService';
import { countryName } from '../utils/countries';
import { Flag } from './CountryPicker';

const UNKNOWN_COUNTRY = 'XX';

function displayName(code: string): string {
  return code === UNKNOWN_COUNTRY ? 'Unknown' : countryName(code);
}

/** Where Guzel Radio listeners are listening from: one row per country, by plays. */
export function ListenerCountries({ countries }: { countries: CountryPlays[] }) {
  const total = countries.reduce((sum, c) => sum + c.plays, 0);
  const known = countries.filter(c => c.country !== UNKNOWN_COUNTRY).length;
  const max = countries[0]?.plays ?? 1;

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      aria-label="Listeners by country"
      className="col-span-full glass rounded-2xl lg:rounded-[2.5rem] p-4 sm:p-8"
    >
      <p className="text-xs text-slate-500 mb-4 sm:mb-6">
        <span className="text-slate-200 font-bold">{total.toLocaleString()}</span> {total === 1 ? 'play' : 'plays'} from{' '}
        <span className="text-slate-200 font-bold">{known.toLocaleString()}</span> {known === 1 ? 'country' : 'countries'}
      </p>
      <ol className="space-y-3 sm:space-y-4">
        {countries.map(({ country, plays }, index) => {
          const share = total > 0 ? Math.round((plays / total) * 100) : 0;
          return (
            <li key={country} className="flex items-center gap-3 sm:gap-4">
              <span className="w-5 sm:w-6 text-right text-[11px] font-bold text-slate-600 tabular-nums shrink-0">{index + 1}</span>
              {/* Image flags: emoji flags show as two letters on Windows */}
              {country === UNKNOWN_COUNTRY
                ? <Globe size={18} className="w-6 text-slate-500 shrink-0" aria-hidden />
                : <Flag code={country} className="!w-6 !h-[18px]" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span className="text-sm font-bold text-slate-100 truncate">{displayName(country)}</span>
                  <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                    {plays.toLocaleString()} {plays === 1 ? 'play' : 'plays'} · {share}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-600"
                    style={{ width: `${Math.max(2, (plays / max) * 100)}%` }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </motion.section>
  );
}
