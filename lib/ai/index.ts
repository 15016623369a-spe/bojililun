import { mockProvider } from './mock';
import { createOpenAIProvider } from './openai';
import type { VisionProvider } from './types';

export type { Recognition, RecognizeInput, RawItem, VisionProvider } from './types';

export function providerName(): string {
  const p = (process.env.AI_PROVIDER || 'mock').toLowerCase();
  return p === 'openai' || p === 'compatible' ? 'openai' : 'mock';
}

export function getProvider(): VisionProvider {
  return providerName() === 'openai' ? createOpenAIProvider() : mockProvider;
}
