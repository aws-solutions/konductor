import { route } from './router.ts';
export function handleRequest(path: string) { return route(path); }
