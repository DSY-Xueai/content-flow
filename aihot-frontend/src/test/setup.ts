import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetResourceCache } from '../api/resources';

afterEach(() => {
  cleanup();
  resetResourceCache();
});
