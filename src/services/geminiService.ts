import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export class GeminiService {
  static async suggestGenres(mood: string): Promise<string[]> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `I'm in a ${mood} mood. Suggest 5 specific musical genres or radio station categories (like 'lofi', 'techno', 'smooth jazz', etc.) that would match this mood. Return only the names of the genres as a comma-separated list without any extra text.`,
      });

      const text = response.text || "";
      return text.split(',').map(s => s.trim().toLowerCase());
    } catch (error) {
      console.error("Gemini failed to suggest genres:", error);
      return ['pop', 'rock', 'country', 'jazz', 'classical'];
    }
  }
}
