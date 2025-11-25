# Plan Engineering Todo View

A VS Code Activity Bar view that lists todos from your backend API.

Maintainer: ariansaputra.com
Product home: go-routine.com

## Usage
- Click the Activity Bar icon “Todo” → view “Tasks”.
- Command “Login” (panel title bar) to paste your backend token; token is validated via `/api/profile`.
- Command “Refresh” to reload tasks for today; tasks are fetched with Bearer token.
- Click a task to see details.
- Command “Logout” to clear the saved token; the panel will show “Login” again.

## Run and develop
- Install deps: `npm install`
- Start watcher: `npm run watch`
- Launch the extension: press `F5` (uses the "Run Extension" config)
