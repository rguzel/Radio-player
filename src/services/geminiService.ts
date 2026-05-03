const MOOD_GENRES: Record<string, string[]> = {
  focus:  ['lofi', 'ambient', 'classical', 'instrumental', 'study', 'piano'],
  chill:  ['chillout', 'lounge', 'acoustic', 'downtempo', 'easy listening', 'coffee'],
  deep:   ['dark ambient', 'deep house', 'synthwave', 'trip-hop', 'electronic', 'minimal'],
  energy: ['dance', 'pop', 'hip-hop', 'electronic', 'reggaeton', 'edm'],
};

export class GeminiService {
  static async suggestGenres(mood: string): Promise<string[]> {
    return MOOD_GENRES[mood] ?? ['pop', 'rock', 'jazz', 'classical', 'electronic'];
  }
}
