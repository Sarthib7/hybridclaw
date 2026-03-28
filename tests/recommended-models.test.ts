import { expect, test } from 'vitest';
import { isRecommendedModel } from '../src/providers/recommended-models.js';

test('recognizes Hermes-derived Hugging Face recommended models', () => {
  expect(
    isRecommendedModel('huggingface/Qwen/Qwen3.5-397B-A17B'),
  ).toBe(true);
  expect(
    isRecommendedModel('huggingface/deepseek-ai/DeepSeek-V3.2'),
  ).toBe(true);
  expect(
    isRecommendedModel('huggingface/zeta/custom-model'),
  ).toBe(false);
});

test('recognizes the extra Qwen3.5 27B and Nemotron recommendations on both providers', () => {
  expect(
    isRecommendedModel('huggingface/Qwen/Qwen3.5-27B-FP8'),
  ).toBe(true);
  expect(
    isRecommendedModel('openrouter/qwen/qwen3.5-27b-a3b-thinking-2507'),
  ).toBe(true);
  expect(
    isRecommendedModel('openrouter/nvidia/nemotron-3-super-120b-a12b:free'),
  ).toBe(true);
  expect(
    isRecommendedModel('huggingface/nvidia/Nemotron-3-Super-120B-A12B'),
  ).toBe(true);
});
