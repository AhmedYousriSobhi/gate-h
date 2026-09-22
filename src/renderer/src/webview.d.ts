// @types/react doesn't declare Electron's <webview> tag - minimal shim for the attributes this
// app actually uses (see GrafanaStatusSection.tsx). Full attribute set:
// https://www.electronjs.org/docs/latest/api/webview-tag
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string
      partition?: string
      allowpopups?: boolean
    }
  }
}
