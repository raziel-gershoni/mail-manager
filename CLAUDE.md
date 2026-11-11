# mail-manager

Repo-specific instructions. They add to the shared workspace instructions and win where the two disagree.

- Build check before pushing: `npx tsc --noEmit && npx next build --webpack`, not a plain `npx next build`. Next 16 builds with Turbopack by default, and Turbopack has no equivalent of the webpack `extensionAlias` hook in `next.config.mjs` (vercel/next.js#82945), so every `next dev`/`next build` here passes `--webpack`.
