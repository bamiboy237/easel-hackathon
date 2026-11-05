# Easel

Easel is a shared canvas where people and AI agents can explore and revise ideas together.

## Run locally

You need Node.js 20.19 or later, or Node.js 22.12 or later, and npm.

1. Install the dependencies:

   ```bash
   npm ci
   ```

2. Create a local environment file:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

3. Set `MODEL_API_KEY` in `.dev.vars` to your key from the [Meta AI developer dashboard](https://dev.meta.ai/).

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open <http://127.0.0.1:5173/>.

The development server listens on your computer only.

## Keep your API key private

Do not commit `.dev.vars` or publish `dist/`. The build can copy local variables into `dist/easel/.dev.vars`.
