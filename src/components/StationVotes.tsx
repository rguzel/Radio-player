import { useState } from 'react';
import { Check, ThumbsUp } from 'lucide-react';
import { RadioStation } from '../types';

const STORAGE_KEY = 'guzel_votes';
// Radio Browser itself allows a vote per IP per station every 10 minutes; the
// app limits it to once a day per station so a vote means something.
const REVOTE_AFTER_MS = 24 * 60 * 60_000;

function readVotes(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function rememberVote(uuid: string) {
  const now = Date.now();
  const votes = Object.fromEntries(
    Object.entries(readVotes()).filter(([, time]) => now - time < REVOTE_AFTER_MS)
  );
  votes[uuid] = now;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(votes));
  } catch {
    // Storage blocked: the vote still counts, it just isn't remembered.
  }
}

function votedRecently(uuid: string): boolean {
  const time = readVotes()[uuid];
  return typeof time === 'number' && Date.now() - time < REVOTE_AFTER_MS;
}

type VoteStatus = 'idle' | 'voting' | 'voted' | 'error';

const numberFormat = new Intl.NumberFormat();

/**
 * Vote count plus a vote button. Render with `key={station.stationuuid}` so the
 * state resets when the station changes.
 */
export function StationVotes({ station, onVote }: {
  station: RadioStation;
  onVote: (uuid: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [status, setStatus] = useState<VoteStatus>(() => (votedRecently(station.stationuuid) ? 'voted' : 'idle'));
  // Only add our vote to the displayed count if it was cast in this view;
  // a count loaded later already includes it.
  const [justVoted, setJustVoted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const vote = async () => {
    setStatus('voting');
    setMessage(null);
    try {
      const result = await onVote(station.stationuuid);
      if (!result.ok) throw new Error(result.message);
      rememberVote(station.stationuuid);
      setJustVoted(true);
      setStatus('voted');
      setMessage('Thanks for voting!');
    } catch (error) {
      setStatus('error');
      const text = error instanceof Error ? error.message : '';
      setMessage(/too often/i.test(text) ? 'You voted for this station recently.' : 'Could not record your vote. Try again later.');
    }
  };

  const votes = (station.votes || 0) + (justVoted ? 1 : 0);
  const voted = status === 'voted';

  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-black tracking-[0.2em] text-slate-600 uppercase">Votes</dt>
      <dd className="flex items-center gap-2">
        <span className="text-xs text-slate-300 font-medium">{numberFormat.format(votes)}</span>
        <button
          onClick={vote}
          disabled={voted || status === 'voting'}
          aria-label={voted ? 'You voted for this station' : `Vote for ${station.name}`}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            voted
              ? 'bg-accent/10 text-accent cursor-default'
              : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-50'
          }`}
        >
          {voted ? <Check size={12} /> : <ThumbsUp size={12} className={status === 'voting' ? 'animate-pulse' : ''} />}
          {voted ? 'Voted' : 'Vote'}
        </button>
      </dd>
      {message && (
        <p role="status" className={`mt-1 text-[10px] ${status === 'error' ? 'text-red-300/80' : 'text-slate-500'}`}>{message}</p>
      )}
    </div>
  );
}
