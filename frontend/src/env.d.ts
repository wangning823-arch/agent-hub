/// <reference types="vite/client" />

declare module '*.css' {
  const content: string
  export default content
}

declare module 'highlight.js/styles/github-dark.css' {
  const content: string
  export default content
}

declare module 'react-dom/client' {
  import { ReactNode } from 'react';
  interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}
