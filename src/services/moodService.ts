// Static mood → Radio Browser tag mapping. No external AI call is involved.
const MOOD_TAGS: Record<string, string[]> = {
  focus:  ['lofi', 'ambient', 'classical', 'instrumental', 'study', 'piano'],
  chill:  ['chillout', 'lounge', 'acoustic', 'downtempo', 'easy listening', 'coffee'],
  deep:   ['dark ambient', 'deep house', 'synthwave', 'trip-hop', 'electronic', 'minimal'],
  energy: ['dance', 'pop', 'hip-hop', 'electronic', 'reggaeton', 'edm'],
};

const DEFAULT_TAGS = ['pop', 'rock', 'jazz', 'classical', 'electronic'];

export function getMoodTags(mood: string): string[] {
  return MOOD_TAGS[mood] ?? DEFAULT_TAGS;
}
