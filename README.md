# Engineer Plan Todo View

A VS Code Activity Bar view that lists todos from your backend API.

Maintainer: https://ariansaputra.com
Product home: https://go-routine.com

## Usage
- Click the Activity Bar icon “Todo” → view “Tasks”.
- Title-bar command “Login” to paste your backend token; token is validated via `/api/profile`.
- Title-bar command “Refresh” to reload tasks for today; tasks are fetched with Bearer token.
- Title-bar command “Create” to post a new todo (prompts title + start/end ISO with offset; defaults use your saved timezone).
- Click a task to see details.
- Title-bar command “Logout” to clear the saved token; the panel will show “Login” again.

## Run and develop
- Install deps: `npm install`
- Start watcher: `npm run watch`
- Launch the extension: press `F5` (uses the "Run Extension" config)
