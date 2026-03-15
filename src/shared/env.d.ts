declare const __APP_VERSION__: string

declare module '*.js?raw' {
  const content: string
  export default content
}
