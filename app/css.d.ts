// Plain stylesheet imports (import "./x.css") are bundled by Next; this tells TypeScript they
// resolve, so its side-effect-import check stays on for everything else.
declare module "*.css";
