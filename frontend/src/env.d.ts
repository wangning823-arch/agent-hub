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

declare module 'react-syntax-highlighter' {
  import { ComponentType } from 'react';
  interface Style {
    [key: string]: React.CSSProperties;
  }
  interface Props {
    language?: string;
    style?: Style;
    showLineNumbers?: boolean;
    wrapLongLines?: boolean;
    customStyle?: React.CSSProperties;
    lineNumberStyle?: React.CSSProperties;
    children: string;
    [key: string]: any;
  }
  export const Prism: ComponentType<Props>;
  export const Light: ComponentType<Props>;
  export default Prism;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  const oneDark: { [key: string]: React.CSSProperties };
  export { oneDark };
  const other: { [key: string]: { [key: string]: React.CSSProperties } };
  export default other;
}
